/**
 * Jhol detectors — turn a TinyFish journey into findings.
 *
 * Pattern names follow the 13 dark patterns in CCPA's Guidelines for Prevention and
 * Regulation of Dark Patterns, 2023.
 *  - Measurable patterns are plain rules here (no AI guessing): drip pricing, basket
 *    sneaking, subscription trap, nagging, false urgency (needs 2 sessions).
 *  - Wording patterns (confirm shaming, trick questions, disguised ads, forced action) go to
 *    an LLM via buildJudgePrompt() → your model → parseJudge(), which drops any finding
 *    whose quote the agent never actually captured.
 */
import type { JourneyResult, LineItem } from "./tinyfish";

export type Pattern =
  | "false_urgency"
  | "basket_sneaking"
  | "confirm_shaming"
  | "forced_action"
  | "subscription_trap"
  | "interface_interference"
  | "bait_and_switch"
  | "drip_pricing"
  | "disguised_advertisement"
  | "nagging"
  | "trick_question"
  | "saas_billing"
  | "rogue_malware";

export type Severity = "high" | "medium" | "low";

export type Finding = {
  pattern: Pattern;
  severity: Severity;
  page: string;
  evidence: string; // exact text the agent captured
  detail: string; // plain-English explanation for the report
  source: "rule" | "llm";
};

/** One agent run plus when it started (TinyFish run.started_at). */
export type Session = { result: JourneyResult; startedAt: string | Date };

const FEE_RE = /fee|charge|handling|platform|convenience|surge|packag|service|delivery|shipping/i;
const SKIP_RE = /sub ?total|grand total|^total|order total|you pay|payable|discount|saving|coupon|gst|tax/i;
const SUB_RE = /trial|membership|subscri|auto[- ]?renew|renews?\b|per month|\/\s?month|monthly/i;
const ADDON_RE = /donat|protect|insur|warrant|guarantee|shield|cover|assur|\btip\b|gift ?wrap|extended/i;
const CART_RE = /cart|bag|basket/i;

const fmt = (n: number) => `₹${Number.isInteger(n) ? n : n.toFixed(2)}`;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const show = (li: LineItem) => (li.amount === null ? li.label : `${li.label} — ${fmt(li.amount)}`);

// ---------------------------------------------------------------------------
// Price drift: what the shopper first saw vs what they'd actually pay
// ---------------------------------------------------------------------------

export function priceDrift(r: JourneyResult) {
  const priced = r.steps.filter((s) => (s.total_shown ?? 0) > 0);
  if (priced.length < 2) return null;
  const first = priced[0];
  const last = priced[priced.length - 1];
  const shown = first.total_shown ?? 0;
  const final = last.total_shown ?? 0;
  return {
    shown,
    final,
    extra: Math.round((final - shown) * 100) / 100,
    pct: Math.round(((final - shown) / shown) * 1000) / 10,
    shownOn: first.page,
    finalOn: last.page,
  };
}

// ---------------------------------------------------------------------------
// Drip pricing: a fee that wasn't disclosed when the price was first shown
// ---------------------------------------------------------------------------

export function detectDripPricing(r: JourneyResult): Finding[] {
  const firstIdx = r.steps.findIndex((s) => (s.total_shown ?? 0) > 0);
  if (firstIdx < 0) return [];
  const firstPage = r.steps[firstIdx];
  const upfront = new Set(firstPage.line_items.map((li) => norm(li.label)));
  const seen = new Set<string>();
  const out: Finding[] = [];

  for (const s of r.steps.slice(firstIdx + 1)) {
    for (const li of s.line_items) {
      const k = norm(li.label);
      const amt = li.amount ?? 0;
      if (amt <= 0 || SKIP_RE.test(li.label) || !FEE_RE.test(li.label)) continue;
      if (upfront.has(k) || seen.has(k)) continue;
      seen.add(k);
      out.push({
        pattern: "drip_pricing",
        severity: CART_RE.test(s.page) ? "medium" : "high",
        page: s.page,
        evidence: show(li),
        detail: `"${li.label}" (${fmt(amt)}) wasn't shown when the price first appeared on the ${firstPage.page} page; it only shows up at ${s.page}.`,
        source: "rule",
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Basket sneaking: something in the order the shopper never added, or a paid add-on pre-ticked
// ---------------------------------------------------------------------------

export function detectBasketSneaking(r: JourneyResult): Finding[] {
  const mine = r.items_added_by_agent.map(norm).filter(Boolean);
  const isMine = (label: string) => {
    const l = norm(label);
    return mine.some((m) => l.includes(m) || m.includes(l));
  };
  const seen = new Set<string>();
  const out: Finding[] = [];

  for (const s of r.steps) {
    // pre-ticked add-ons first, so they get the clearer explanation
    for (const li of s.preselected) {
      const k = norm(li.label);
      const amt = li.amount ?? 0;
      if (!k || seen.has(k) || isMine(li.label) || SUB_RE.test(li.label) || FEE_RE.test(li.label)) continue;
      if (amt <= 0 && !ADDON_RE.test(li.label)) continue; // e.g. a default size, not a sneaked add-on
      seen.add(k);
      out.push({
        pattern: "basket_sneaking",
        severity: amt > 0 ? "high" : "medium",
        page: s.page,
        evidence: show(li),
        detail: `"${li.label}" came pre-selected, so the shopper has to spot it and opt out themselves.`,
        source: "rule",
      });
    }
    for (const li of s.line_items) {
      const k = norm(li.label);
      const amt = li.amount ?? 0;
      if (amt <= 0 || !k || seen.has(k) || isMine(li.label)) continue;
      if (SKIP_RE.test(li.label) || FEE_RE.test(li.label) || SUB_RE.test(li.label)) continue;
      seen.add(k);
      out.push({
        pattern: "basket_sneaking",
        severity: "high",
        page: s.page,
        evidence: show(li),
        detail: `"${li.label}" (${fmt(amt)}) is in the order, but the shopper never added it.`,
        source: "rule",
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Subscription trap: a trial / membership that renews into a paid plan, slipped in
// ---------------------------------------------------------------------------

export function detectSubscriptionTrap(r: JourneyResult): Finding[] {
  const mine = r.items_added_by_agent.map(norm).filter(Boolean);
  const seen = new Set<string>();
  const out: Finding[] = [];

  for (const s of r.steps) {
    const candidates = [
      ...s.preselected.map((li) => ({ li, preselected: true })),
      ...s.line_items.map((li) => ({ li, preselected: false })),
    ];
    for (const { li, preselected } of candidates) {
      const k = norm(li.label);
      if (!SUB_RE.test(li.label) || seen.has(k)) continue;
      if (!preselected && mine.some((m) => k.includes(m))) continue; // shopper chose it
      seen.add(k);
      out.push({
        pattern: "subscription_trap",
        severity: "high",
        page: s.page,
        evidence: show(li),
        detail: preselected
          ? `"${li.label}" was pre-selected, so the shopper can end up on a recurring paid plan without actively choosing it.`
          : `"${li.label}" is in the order although the shopper never chose a subscription.`,
        source: "rule",
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Nagging: the same popup keeps coming back across pages
// ---------------------------------------------------------------------------

const words = (t: string) =>
  new Set(
    norm(t)
      .replace(/[^\p{L}\p{N} ]/gu, " ")
      .split(" ")
      .filter((w) => w.length > 2),
  );

/** Agents often record a shortened version of the same popup, so compare against the shorter text. */
const similarity = (a: Set<string>, b: Set<string>) => {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  const smaller = Math.min(a.size, b.size);
  if (smaller >= 3) return shared / smaller;
  const union = a.size + b.size - shared;
  return union ? shared / union : 0;
};

export function detectNagging(r: JourneyResult, minPages = 3): Finding[] {
  const clusters: { text: string; bag: Set<string>; pages: string[] }[] = [];
  for (const s of r.steps) {
    const counted = new Set<number>();
    for (const text of s.popups) {
      const bag = words(text);
      if (!bag.size) continue;
      let idx = clusters.findIndex((c) => similarity(c.bag, bag) >= 0.6);
      if (idx < 0) idx = clusters.push({ text, bag, pages: [] }) - 1;
      if (!counted.has(idx)) {
        clusters[idx].pages.push(s.page);
        counted.add(idx);
      }
    }
  }
  return clusters
    .filter((c) => c.pages.length >= minPages)
    .map((c) => ({
      pattern: "nagging" as const,
      severity: "medium" as const,
      page: c.pages.join(", "),
      evidence: c.text,
      detail: `The same popup interrupted the shopper on ${c.pages.length} pages (${c.pages.join(", ")}).`,
      source: "rule" as const,
    }));
}

// ---------------------------------------------------------------------------
// False urgency — needs two sessions ~2 min apart (SESSION_B_DELAY_MS in tinyfish.ts)
//  - a real deadline keeps counting down between visits; a fake one restarts for every visitor
//  - stock that goes UP within minutes isn't real stock
// ---------------------------------------------------------------------------

const TIMER_RE = /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/;
const STOCK_RE =
  /only\s+(\d+)\s+(?:items?\s+|pieces?\s+|units?\s+)?(?:left|remaining)|(\d+)\s+(?:items?\s+)?left\s+in\s+stock/i;

function timerSeconds(t: string): number | null {
  const m = t.match(TIMER_RE);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return m[3] === undefined ? a * 60 + b : a * 3600 + b * 60 + Number(m[3]);
}

function stockCount(t: string): number | null {
  const m = t.match(STOCK_RE);
  return m ? Number(m[1] ?? m[2]) : null;
}

function firstMatch(r: JourneyResult, pick: (t: string) => number | null) {
  for (const s of r.steps) {
    for (const t of s.urgency_texts) {
      const v = pick(t);
      if (v !== null) return { v, t, page: s.page };
    }
  }
  return null;
}

export function detectFalseUrgency(x: Session, y: Session): Finding[] {
  const [a, b] = new Date(x.startedAt).getTime() <= new Date(y.startedAt).getTime() ? [x, y] : [y, x];
  const gap = (new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()) / 1000;
  const out: Finding[] = [];

  const ta = firstMatch(a.result, timerSeconds);
  const tb = firstMatch(b.result, timerSeconds);
  if (ta && tb && gap >= 60 && tb.v > ta.v - gap / 2) {
    out.push({
      pattern: "false_urgency",
      severity: "high",
      page: tb.page,
      evidence: `Visit A: "${ta.t}" · Visit B, ${Math.round(gap)}s later: "${tb.t}"`,
      detail: `A real deadline would have dropped by about ${Math.round(gap)}s between the two visits. This countdown restarted, so the deadline is fake.`,
      source: "rule",
    });
  }

  const sa = firstMatch(a.result, stockCount);
  const sb = firstMatch(b.result, stockCount);
  if (sa && sb && sa.v !== sb.v) {
    const up = sb.v > sa.v;
    out.push({
      pattern: "false_urgency",
      severity: up ? "high" : "low",
      page: sb.page,
      evidence: `Visit A: "${sa.t}" · Visit B: "${sb.t}"`,
      detail: up
        ? "Stock went UP between two visits minutes apart, so the scarcity message isn't based on real stock."
        : "The stock claim changed between visits. Could be real sales; re-run to confirm.",
      source: "rule",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Run everything that doesn't need an LLM
// ---------------------------------------------------------------------------

const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export function runRuleDetectors(a: Session, b?: Session) {
  const findings: Finding[] = [
    ...detectDripPricing(a.result),
    ...detectBasketSneaking(a.result),
    ...detectSubscriptionTrap(a.result),
    ...detectNagging(a.result),
    ...(b ? detectFalseUrgency(a, b) : []),
  ].sort((p, q) => RANK[p.severity] - RANK[q.severity]);
  return { findings, drift: priceDrift(a.result) };
}

/** 100 = clean. Simple and explainable on a slide. */
export function jholScore(findings: Finding[]): number {
  const penalty = findings.reduce((s, f) => s + (f.severity === "high" ? 15 : f.severity === "medium" ? 7 : 3), 0);
  return Math.max(0, 100 - penalty);
}

// ---------------------------------------------------------------------------
// LLM judge for wording-based patterns
// ---------------------------------------------------------------------------

/** Send this to your LLM (ask for JSON only), then pass the reply to parseJudge(). */
export function buildJudgePrompt(r: JourneyResult): string {
  const evidence = r.steps
    .map((s, i) => {
      const parts = [
        s.choice_texts.length ? `  choices: ${JSON.stringify(s.choice_texts)}` : "",
        s.popups.length ? `  popups: ${JSON.stringify(s.popups)}` : "",
        s.preselected.length ? `  preselected: ${JSON.stringify(s.preselected.map(show))}` : "",
        s.urgency_texts.length ? `  urgency: ${JSON.stringify(s.urgency_texts)}` : "",
      ].filter(Boolean);
      return parts.length ? `#${i + 1} ${s.page}\n${parts.join("\n")}` : "";
    })
    .filter(Boolean)
    .join("\n\n");

  return `You are a consumer-protection analyst in India. Judge ONLY these wording-based dark patterns from CCPA's 2023 dark-pattern guidelines:
- confirm_shaming: guilt, fear, ridicule or shame used to push a choice, e.g. a decline option worded to make the shopper feel careless.
- trick_question: confusing or misleading wording (double negatives, ambiguous options) that steers the shopper into a choice they didn't mean.
- disguised_advertisement: ads dressed up as normal content, reviews or user posts.
- forced_action: forcing an unrelated action (sign-up, sharing data, app download, buying something extra) to finish the purchase.
Text may be English, Hindi or Hinglish. Report only what the evidence shows and quote the exact text. Ignore anything that is only about prices or timers. If nothing qualifies, return an empty list.

Evidence captured by the shopping agent:
${evidence || "(no offers, popups or pre-selected options were recorded)"}

Reply with JSON only:
{"findings":[{"pattern":"confirm_shaming|trick_question|disguised_advertisement|forced_action","page":"...","evidence":"exact quote","detail":"one-sentence reason","severity":"high|medium|low"}]}`;
}

const LLM_PATTERNS = new Set<string>(["confirm_shaming", "trick_question", "disguised_advertisement", "forced_action"]);
const SEVERITIES = new Set<string>(["high", "medium", "low"]);

/** Parses the LLM reply and keeps only findings whose quote really appears in what the agent captured. */
export function parseJudge(reply: string, r: JourneyResult): Finding[] {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return [];

  const captured = norm(
    r.steps
      .flatMap((s) => [...s.choice_texts, ...s.popups, ...s.urgency_texts, ...s.preselected.map((li) => li.label)])
      .join(" \n "),
  );
  const quoted = (ev: string) => {
    const e = norm(ev).replace(/^["'“‘]|["'”’]$/g, "");
    return e.length > 0 && (captured.includes(e) || (e.length > 30 && captured.includes(e.slice(0, 30))));
  };

  try {
    const parsed = JSON.parse(reply.slice(start, end + 1)) as { findings?: unknown };
    if (!Array.isArray(parsed.findings)) return [];
    return parsed.findings.flatMap((f): Finding[] => {
      const o = (f ?? {}) as Record<string, unknown>;
      const pattern = String(o.pattern ?? "");
      const severity = String(o.severity ?? "");
      const evidence = String(o.evidence ?? "").trim();
      if (!LLM_PATTERNS.has(pattern) || !quoted(evidence)) return [];
      return [
        {
          pattern: pattern as Pattern,
          severity: (SEVERITIES.has(severity) ? severity : "medium") as Severity,
          page: String(o.page ?? ""),
          evidence,
          detail: String(o.detail ?? ""),
          source: "llm",
        },
      ];
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Tamper evidence: store this hash with the report; any later edit changes it
// ---------------------------------------------------------------------------

export async function sealReport(report: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(report));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
