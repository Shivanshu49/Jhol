/**
 * One compact, model-readable view of the current page.
 * Every visible interactive element gets data-jhol-id="eN" so the agent can act on it by id.
 */
import type { Page } from "playwright";

export type SnapElement = {
  id: string;
  tag: string;
  type: string;
  name: string;
  text: string;
  label: string;
  checked: boolean | null;
  disabled: boolean;
  /** Another element (a popup, overlay, banner) sits on top of it, so a click would land on that instead. */
  covered: boolean;
};

export type Snapshot = {
  url: string;
  title: string;
  headings: string[];
  elements: SnapElement[];
  priceLines: string[];
  urgencyLines: string[];
  dialogs: string[];
  /** Checked checkboxes/radios/switches with their label text. Captured by code, never by the model. */
  checked: string[];
};

const MAX_CHARS = 6_000; // fits Cerebras gpt-oss-120b's ~8k-token context with the prompt and reply

export async function takeSnapshot(page: Page): Promise<Snapshot> {
  // The callback runs in the browser; keep it self-contained (no outer references).
  const s = await page.evaluate(() => {
    const clean = (t: string | null | undefined, max: number) => (t ?? "").replace(/\s+/g, " ").trim().slice(0, max);
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const cs = getComputedStyle(el);
      return cs.display !== "none" && cs.visibility !== "hidden";
    };
    const isCovered = (el: Element) => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false; // off-screen: unknown, Playwright scrolls
      const top = document.elementFromPoint(x, y);
      const box = (el as HTMLInputElement).labels?.[0] ?? el.closest("label");
      return !!top && !el.contains(top) && !top.contains(el) && !(box && box.contains(top));
    };
    const labelOf = (el: Element) => {
      const i = el as HTMLInputElement;
      const l = i.labels?.[0] ?? el.closest("label");
      return clean(l ? (l as HTMLElement).innerText : el.getAttribute("aria-label"), 120);
    };

    document.querySelectorAll("[data-jhol-id]").forEach((el) => el.removeAttribute("data-jhol-id"));
    const SEL = "button, a[href], [role=button], [role=checkbox], [role=switch], [role=radio], input:not([type=hidden]), select, textarea";
    const elements: SnapElement[] = [];
    let n = 0;
    for (const el of Array.from(document.querySelectorAll(SEL))) {
      const label = labelOf(el);
      // Custom checkboxes often hide the real <input>; keep it if its label is visible.
      const lab = (el as HTMLInputElement).labels?.[0] ?? el.closest("label");
      if (!visible(el) && !(lab && visible(lab))) continue;
      const id = `e${++n}`;
      el.setAttribute("data-jhol-id", id);
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute("type") ?? el.getAttribute("role") ?? "").toLowerCase();
      const isBox = /checkbox|radio|switch/.test(type);
      const f = el as HTMLInputElement;
      const opts = tag === "select" ? Array.from((el as HTMLSelectElement).options).slice(0, 10).map((o) => o.text).join(" | ") : "";
      const text = clean(
        (isBox && label) || opts || (el as HTMLElement).innerText || f.value || el.getAttribute("aria-label") || f.placeholder || el.getAttribute("title"),
        isBox ? 120 : 80, // a checkbox's label is its whole meaning (price, fine print)
      );
      elements.push({
        id,
        tag,
        type,
        name: clean(el.getAttribute("name"), 40),
        text,
        label: label === text ? "" : label,
        checked: isBox ? (tag === "input" ? f.checked : el.getAttribute("aria-checked") === "true") : null,
        disabled: f.disabled === true || el.getAttribute("aria-disabled") === "true",
        covered: isCovered(el),
      });
    }

    // Short text "lines": the largest visible ancestor of a matching text node whose text is still <= 120 chars,
    // so a row like "Platform fee ₹19" stays together even when the label and amount sit in separate spans.
    const PRICE = /₹|\brs\.?\s?\d|\binr\b|\d\.00\b/i;
    const URGENT = /\b\d{1,2}:\d{2}\b|left in stock|only \d+ left|viewing/i;
    const lines = new Set<Element>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      let el = node.parentElement;
      if (!el || !node.textContent?.trim() || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName)) continue;
      const t = clean(el.innerText, 200);
      if (!t || t.length > 120 || !(PRICE.test(t) || URGENT.test(t)) || !visible(el)) continue;
      while (
        el.tagName !== "LABEL" &&
        el.parentElement &&
        el.parentElement !== document.body &&
        !el.parentElement.querySelector("input[type=checkbox], input[type=radio], [role=checkbox], [role=radio], [role=switch]") &&
        (el.parentElement.textContent?.length ?? 0) < 2000 && // cheap bail before measuring innerText
        clean(el.parentElement.innerText, 200).length <= 120
      ) {
        el = el.parentElement;
      }
      lines.add(el);
    }
    const texts = [...new Set(Array.from(lines, (el) => clean((el as HTMLElement).innerText, 120)))];
    // Offers remain readable as unchecked elements, but are not order-price rows.
    const uncheckedLabels = elements.filter((e) => e.checked === false).flatMap((e) => {
      const input = document.querySelector(`[data-jhol-id="${e.id}"]`) as HTMLInputElement;
      return Array.from(input.labels ?? []).concat(input.closest("label") ? [input.closest("label")!] : []);
    });
    const orderPrices = [...new Set(Array.from(lines).filter((el) => !uncheckedLabels.some((label) => label.contains(el)))
      .map((el) => clean((el as HTMLElement).innerText, 120)))];

    const dialogEls = new Set<Element>(
      Array.from(document.querySelectorAll("dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]")).filter(visible),
    );
    for (let el = document.elementFromPoint(innerWidth / 2, innerHeight / 2); el; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" && Number(cs.zIndex) >= 100) dialogEls.add(el);
    }

    const checked = Array.from(
      document.querySelectorAll("input[type=checkbox]:checked, input[type=radio]:checked, [role=checkbox][aria-checked=true], [role=switch][aria-checked=true]"),
    )
      .filter((el) => {
        const lab = (el as HTMLInputElement).labels?.[0] ?? el.closest("label");
        return visible(el) || (lab && visible(lab));
      })
      .map((el) => labelOf(el) || clean(el.getAttribute("name"), 60))
      .filter(Boolean);

    return {
      url: location.href,
      title: clean(document.title, 120),
      headings: Array.from(document.querySelectorAll("h1, h2, h3")).filter(visible).map((h) => clean((h as HTMLElement).innerText, 120)).filter(Boolean).slice(0, 10),
      elements,
      priceLines: orderPrices.filter((t) => PRICE.test(t)).slice(0, 40),
      urgencyLines: texts.filter((t) => URGENT.test(t)).slice(0, 40),
      dialogs: [...new Set(Array.from(dialogEls, (el) => clean((el as HTMLElement).innerText, 600)))].filter(Boolean),
      checked,
    };
  });

  // Over budget: drop links first (navigation/footer noise), then the longest price lines, then anything from the end.
  while (snapshotToText(s).length > MAX_CHARS) {
    const link = s.elements.map((e) => e.tag).lastIndexOf("a");
    if (link >= 0) s.elements.splice(link, 1);
    else if (s.priceLines.length > 10) s.priceLines.splice(s.priceLines.indexOf(s.priceLines.reduce((a, b) => (b.length > a.length ? b : a))), 1);
    else if (s.elements.length) s.elements.pop();
    else break;
  }
  return s;
}

export function snapshotToText(s: Snapshot): string {
  const el = (e: SnapElement) => {
    const kind = e.tag === "input" ? e.type || "text" : e.tag === "a" ? "link" : e.type && e.tag !== "button" ? e.type : e.tag;
    return [
      `[${e.id}] ${kind}`,
      e.checked === true ? "CHECKED" : e.checked === false ? "unchecked" : "",
      e.disabled ? "DISABLED" : "",
      e.covered ? "COVERED" : "",
      e.name ? `name=${e.name}` : "",
      JSON.stringify(e.text),
      e.label ? `label=${JSON.stringify(e.label)}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  };
  const block = (title: string, xs: string[]) => (xs.length ? [`${title}:`, ...xs.map((x) => `- ${x}`)] : []);
  return [
    `URL: ${s.url}`,
    `Title: ${s.title}`,
    ...block("Headings", s.headings),
    ...block("Open dialogs", s.dialogs),
    "Elements:",
    ...s.elements.map(el),
    ...block("Price lines", s.priceLines),
    ...block("Urgency lines", s.urgencyLines),
  ].join("\n");
}
