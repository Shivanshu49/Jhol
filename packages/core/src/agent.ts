/**
 * Jhol's own browser agent: Playwright drives the page, an OpenAI-compatible model picks one action per step.
 * Page data comes from the model; what was pre-selected comes from code (the first snapshot of each page).
 *
 * Env: AGENT_LLM=cerebras|openai (default cerebras)
 *   cerebras → CEREBRAS_API_KEY, CEREBRAS_MODEL (default gpt-oss-120b)
 *   openai   → OPENAI_API_KEY, OPENAI_MODEL, optional OPENAI_BASE_URL
 */
import { getDefaultAutoSelectFamilyAttemptTimeout, setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { chromium, type Page } from "playwright";
import { checkoutGoal, toJourney, type JourneyResult, type JourneyStep, type LineItem } from "./journey";
import { isPublicUrl, startGuardProxy } from "./netguard";
import { snapshotToText, takeSnapshot, type SnapElement, type Snapshot } from "./snapshot";

// Node aborts each connect attempt after 250 ms (happy eyeballs); on slow links (1.4 s TCP connect to api.openai.com seen)
// that surfaces as random "Connection error." from the OpenAI SDK. Raise it, never lower it.
setDefaultAutoSelectFamilyAttemptTimeout(Math.max(getDefaultAutoSelectFamilyAttemptTimeout(), 2500));

export type AgentAction = {
  type: "click" | "fill" | "select" | "stop";
  target: string | null;
  value: string | null;
  reason: string;
};

export type PageData = {
  total_shown: number | null;
  line_items: LineItem[];
  urgency_texts: string[];
  choice_texts: string[];
  popups: string[];
};

type Decision = { page: string; page_data: PageData; product_added: string | null; action: AgentAction };

export type LlmProvider = "cerebras" | "openai";

export type AgentStepEvent = {
  index: number;
  url: string;
  page: string;
  action: AgentAction;
  /** Visible text of the element acted on ("Add to cart"), if any. */
  targetText: string | null;
  screenshot: Buffer;
  newFindingsHint: PageData;
  /** Why the action failed or was refused, if it did. */
  error: string | null;
  llm: { provider: LlmProvider; model: string; latencyMs: number };
};

export type RunJourneyOptions = {
  pincode?: string;
  maxSteps?: number;
  onStep?: (step: AgentStepEvent) => void | Promise<void>;
  headless?: boolean;
  /** Let the browser reach localhost / private networks. Only for local test stores (the CLI); never for user-submitted URLs. */
  allowPrivateNetwork?: boolean;
  /** Overrides AGENT_LLM. */
  llm?: LlmProvider;
};

const RULES = `
You see ONE page at a time as a text snapshot. Reply with JSON describing the CURRENT page (page, page_data with the field meanings above, product_added) and the ONE next action.
RULES:
- Choose element ids only from the snapshot. Never invent ids.
- Add exactly one unit of the cheapest product. Set product_added to its name on the step where you add it to the cart; otherwise null.
- When a popup or upsell appears: first copy BOTH the accept and the decline wording into choice_texts, then choose the decline/close option.
- Never untick or remove anything the site pre-selected.
- Never type into card, CVV, UPI, OTP or password fields. Use Test User / test@example.com / the pincode for guest forms.
- Stop as soon as payment options are visible. A "Continue to payment" button is not the payment step: click it.
- Amounts are plain numbers in rupees (no ₹, no commas).
- Copy labels and texts exactly as written on the page. A line item's label is its name without the amount.
- page: a short name (home, product, cart, checkout, review, payment). Keep the same name while you stay on a page; a popup does not change it.
- total_shown: the product's price on a product page, the order total on cart/checkout/review/payment pages, null on listing pages.
- line_items: only the order: the product on its own product page, and the rows of the cart/checkout/review/payment pages. Leave it EMPTY on home and listing pages.
- An element marked COVERED is behind a popup or overlay and can't be clicked. Deal with the popup first (decline/close it).`;

type Schema = {
  type: string | string[];
  enum?: string[];
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
};
const str: Schema = { type: "string" };
const strs: Schema = { type: "array", items: str };
const obj = (properties: Record<string, Schema>): Schema => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

/** Strict json_schema: every object closed, every field required, nullables as type unions. */
const DECISION_SCHEMA = obj({
  page: str,
  page_data: obj({
    total_shown: { type: ["number", "null"] },
    line_items: { type: "array", items: obj({ label: str, amount: { type: ["number", "null"] } }) },
    urgency_texts: strs,
    choice_texts: strs,
    popups: strs,
  }),
  product_added: { type: ["string", "null"] },
  action: obj({
    type: { type: "string", enum: ["click", "fill", "select", "stop"] },
    target: { type: ["string", "null"] },
    value: { type: ["string", "null"] },
    reason: str,
  }),
});

/** Checks a reply against DECISION_SCHEMA ourselves, for providers that can't enforce json_schema. Returns the first problem or null. */
export function decisionError(v: unknown, s: Schema = DECISION_SCHEMA, path = "reply"): string | null {
  const types = ([] as string[]).concat(s.type);
  const is = (t: string) =>
    t === "null" ? v === null
    : t === "array" ? Array.isArray(v)
    : t === "object" ? typeof v === "object" && v !== null && !Array.isArray(v)
    : t === "number" ? typeof v === "number" && Number.isFinite(v)
    : typeof v === t;
  if (!types.some(is)) return `${path} must be ${types.join(" or ")}`;
  if (s.enum && !s.enum.includes(v as string)) return `${path} must be one of ${s.enum.join(", ")}`;
  if (Array.isArray(v) && s.items) {
    for (const [i, x] of v.entries()) {
      const e = decisionError(x, s.items, `${path}[${i}]`);
      if (e) return e;
    }
  } else if (s.properties) {
    for (const k of s.required ?? []) {
      const e = decisionError((v as Record<string, unknown>)[k], s.properties[k], `${path}.${k}`);
      if (e) return e;
    }
  }
  return null;
}

/** Model JSON can contain NUL or lone surrogates, which PostgreSQL jsonb cannot store. */
export function parseDecision(content: string): Decision {
  const parsed: unknown = JSON.parse(content, (_key, value: unknown) => typeof value === "string"
    ? Buffer.from(value, "utf8").toString("utf8").replace(/\u0000/g, "\uFFFD") : value);
  const error = decisionError(parsed);
  if (error) throw new Error(error);
  return parsed as Decision;
}

type Llm = { provider: LlmProvider; model: string; client: OpenAI; jsonSchema: boolean };

function llmFor(choice: string): Llm {
  if (choice === "cerebras") {
    const apiKey = process.env.CEREBRAS_API_KEY;
    if (!apiKey) throw new Error("CEREBRAS_API_KEY is not set");
    const client = new OpenAI({ apiKey, baseURL: "https://api.cerebras.ai/v1" });
    return { provider: "cerebras", model: process.env.CEREBRAS_MODEL || "gpt-oss-120b", client, jsonSchema: true };
  }
  if (choice === "openai") {
    const model = process.env.OPENAI_MODEL;
    if (!model) throw new Error("OPENAI_MODEL is not set");
    return { provider: "openai", model, client: new OpenAI({ baseURL: process.env.OPENAI_BASE_URL || undefined }), jsonSchema: true };
  }
  throw new Error(`AGENT_LLM / --llm must be "cerebras" or "openai", got "${choice}"`);
}

async function complete(llm: Llm, messages: ChatCompletionMessageParam[]): Promise<string> {
  const [system, ...rest] = messages;
  try {
    const res = await llm.client.chat.completions.create({
      model: llm.model,
      messages: llm.jsonSchema
        ? messages
        : [{ role: "system", content: `${system.content}\nReply with ONE JSON object matching this JSON schema:\n${JSON.stringify(DECISION_SCHEMA)}` }, ...rest],
      response_format: llm.jsonSchema
        ? { type: "json_schema", json_schema: { name: "agent_step", strict: true, schema: DECISION_SCHEMA } }
        : { type: "json_object" },
    });
    return res.choices[0]?.message?.content ?? "";
  } catch (e) {
    // Provider rejected json_schema: use json_object + our own validation for the rest of the run.
    if (llm.jsonSchema && e instanceof OpenAI.APIError && (e.status === 400 || e.status === 422)) {
      llm.jsonSchema = false;
      return complete(llm, messages);
    }
    throw e;
  }
}

/** One decision; an invalid reply is retried once with the error. Throws OpenAI.APIError for provider failures. */
async function decide(llm: Llm, system: string, user: string): Promise<Decision> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  for (let attempt = 1; ; attempt++) {
    const content = await complete(llm, messages);
    let err: string | null;
    try {
      return parseDecision(content);
    } catch (e) {
      err = (e as Error).message;
    }
    if (attempt === 2) throw new Error(`invalid reply after retry: ${err}`);
    messages.push({ role: "assistant", content }, { role: "user", content: `Your reply was invalid: ${err}. Reply again with only the corrected JSON object.` });
  }
}

const SETTLE_MS = 1000; // Chalak Mart's nag popup lands ~700 ms after each render; wait past it.
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];
const AMOUNT_RE = /(?:₹|rs\.?|inr)\s*(-?[\d,]+(?:\.\d+)?)/i;
const SENSITIVE_RE = /card|cvv|cvc|csc|upi|vpa|otp|one-time|expiry|password|passcode|\bpin\b|\bcc[-_]/i;
const PAY_FIELD_RE = /card|cvv|cvc|upi|vpa|expiry/i;
const NOT_PAY_RE = /gift|discount|coupon|promo|voucher/i;
const PAY_METHOD_RE = /^(pay (via|with|using) )?(upi|cards?|credit card|debit card|credit \/ debit card|net ?banking|cash on delivery|cod|wallets?)\s*$/i;
const SUBMIT_ORDER_RE = /\b(place (?:your )?order|pay now|confirm (?:order|and pay)|complete (?:purchase|order)|submit order|buy now and pay)\b/i;

/** A single payment method is enough: COD-only stores must never reach order submission. */
export function paymentVisible(s: Snapshot): boolean {
  const field = s.elements.some((e) => {
    const t = `${e.name} ${e.label} ${e.text}`;
    return /input|textarea/.test(e.tag) && !/checkbox|radio|submit|button/.test(e.type) && PAY_FIELD_RE.test(t) && !NOT_PAY_RE.test(t);
  });
  const methods = new Set(s.elements.filter((e) => e.text.length <= 40 && PAY_METHOD_RE.test(e.text)).map((e) => norm(e.text)));
  return field || methods.size >= 1 || s.elements.some((e) => SUBMIT_ORDER_RE.test(`${e.text} ${e.label}`));
}

const preselectedItem = (text: string): LineItem => {
  const m = text.match(AMOUNT_RE);
  return { label: text, amount: m ? Number(m[1].replace(/,/g, "")) : null };
};

const words = (s: string) => ` ${(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ")} `;

/**
 * The model names one item differently across pages: the checkbox text "Order Protection (₹49): covers loss in transit"
 * or "Donation to Green India Fund remove" on the cart, "Order Protection" on review. Map every label to the SHORTEST
 * other journey label it contains (whole words, 4+ chars), so detectors don't count the same item twice.
 */
export function canonicaliseItems(steps: JourneyStep[]): void {
  const pool = steps.flatMap((s) => [...s.line_items, ...s.preselected]);
  const canon = (li: LineItem): LineItem => {
    const w = words(li.label);
    const hit = pool
      .filter((o) => words(o.label).length >= 6 && words(o.label).length < w.length && w.includes(words(o.label)))
      .sort((a, b) => a.label.length - b.label.length)[0];
    return hit ? { label: hit.label, amount: li.amount ?? hit.amount } : li;
  };
  const dedupe = (items: LineItem[]) => [...new Map(items.map((li) => [norm(li.label), li])).values()];
  for (const s of steps) {
    s.line_items = dedupe(s.line_items.map(canon));
    s.preselected = dedupe(s.preselected.map(canon));
  }
}

/**
 * product_added as the page labels it: the model sometimes misspells it ("Cotten Crew Tee"), and then detectors flag the
 * shopper's own product as sneaked in. Use the journey label sharing the most words (at least half), else keep it.
 */
export function matchAdded(name: string, steps: JourneyStep[]): string {
  const want = words(name).trim().split(" ");
  let best = name;
  let score = Math.ceil(want.length / 2) - 1;
  for (const li of steps.flatMap((s) => s.line_items)) {
    if (words(li.label).includes(words(name))) return name;
    const got = new Set(words(li.label).trim().split(" "));
    const n = want.filter((w) => got.has(w)).length;
    if (n > score) [best, score] = [li.label, n];
  }
  return best;
}

/** Hard safety rules, enforced in code whatever the model says. Returns why the action is refused, or null. */
export function refusal(el: SnapElement, a: AgentAction): string | null {
  if (a.type === "click" && SUBMIT_ORDER_RE.test(`${el.text} ${el.label} ${el.name}`)) {
    return "Refused: never submit an order or payment.";
  }
  if (a.type === "click" && el.checked && el.type !== "radio") return "Refused: that would untick something the site pre-selected.";
  if ((a.type === "fill" || a.type === "select") && (el.type === "password" || SENSITIVE_RE.test(`${el.name} ${el.label} ${el.text}`))) {
    return "Refused: never type into payment, OTP or password fields.";
  }
  return null;
}

async function act(page: Page, snap: Snapshot, a: AgentAction): Promise<void> {
  const el: SnapElement | undefined = snap.elements.find((e) => e.id === a.target);
  if (!el) throw new Error(`There is no element "${a.target}" on the page now (it changed; a popup you closed is gone). Use only ids from the current snapshot.`);
  const refused = refusal(el, a);
  if (refused) throw new Error(refused);
  const loc = page.locator(`[data-jhol-id="${el.id}"]`);
  if (a.type === "click") await loc.click();
  else if (a.type === "fill") await loc.fill(a.value ?? "");
  else if (a.type === "select") await loc.selectOption(a.value ?? "");
}

export async function runJourney(url: string, opts: RunJourneyOptions = {}): Promise<JourneyResult & { stepsTaken: number }> {
  const llm = llmFor(opts.llm ?? (process.env.AGENT_LLM || "cerebras"));
  const system = checkoutGoal(opts.pincode) + "\n" + RULES;
  const maxSteps = opts.maxSteps ?? 25;

  const steps: JourneyStep[] = [];
  const added: string[] = [];
  const history: string[] = [];
  let reached = false;
  let stopReason = "max steps reached";
  let lastError = "";
  let lastKey = "";
  let repeats = 0;
  let stopRefused = false;
  let stepsTaken = 0;

  if (!opts.allowPrivateNetwork && !(await isPublicUrl(url))) {
    throw new Error(`Refusing to open ${url}: only public http(s) websites can be audited.`);
  }

  // Unless explicitly allowed, all browser traffic goes through the guard proxy (see netguard.ts).
  const proxy = opts.allowPrivateNetwork ? null : await startGuardProxy();
  const browser = await chromium
    .launch({ headless: opts.headless ?? true, proxy: proxy ? { server: proxy.server } : undefined })
    .catch((e) => {
      proxy?.close();
      throw e;
    });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(5000);
    await page.goto(url, { waitUntil: "load", timeout: 30_000 });
    await page.waitForTimeout(SETTLE_MS);

    for (let i = 1; i <= maxSteps; i++) {
      const snap = await takeSnapshot(page);
      const text = snapshotToText(snap);

      // Loop guard; digits are masked so a ticking countdown doesn't look like progress.
      const key = text.replace(/\d+/g, "#");
      repeats = key === lastKey ? repeats + 1 : 1;
      lastKey = key;
      if (repeats >= 5) {
        stopReason = "stuck";
        break;
      }

      stepsTaken = i;
      const user = [
        `Current URL: ${snap.url}`,
        `Snapshot:\n${text}`,
        `Actions so far (last 5):\n${history.slice(-5).join("\n") || "(none)"}`, // small context on Cerebras
        lastError && `Your last action FAILED: ${lastError}`,
        repeats >= 3 && "You are stuck; try a different element or stop.",
      ]
        .filter(Boolean)
        .join("\n\n");

      let d: Decision;
      const t0 = Date.now();
      try {
        d = await decide(llm, system, user);
      } catch (e) {
        if (e instanceof OpenAI.APIError) throw e; // auth/quota/model errors won't fix themselves
        lastError = (e as Error).message; // "invalid reply after retry: ..."
        continue;
      }
      const latencyMs = Date.now() - t0;

      // Record the page. preselected comes from this (first) snapshot of a new page, never from the model.
      const name = norm(d.page) || "page";
      const pd = d.page_data;
      const last = steps.at(-1);
      if (last && last.page === name) {
        last.total_shown = pd.total_shown ?? last.total_shown;
        const byLabel = new Map([...last.line_items, ...pd.line_items].map((li) => [norm(li.label), li]));
        last.line_items = [...byLabel.values()];
        last.urgency_texts = union(last.urgency_texts, pd.urgency_texts);
        last.choice_texts = union(last.choice_texts, pd.choice_texts);
        last.popups = union(last.popups, pd.popups);
      } else {
        steps.push({ page: name, ...pd, preselected: snap.checked.map(preselectedItem) });
      }
      if (d.product_added) added.push(d.product_added);

      const atPayment = paymentVisible(snap);
      const a: AgentAction = atPayment
        ? { type: "stop", target: null, value: null, reason: "Payment options visible; never submit an order or payment." }
        : d.action;
      // Evidence belongs to the snapshot described above, before a click can navigate or close a popup.
      const screenshot = await page.screenshot({ type: "jpeg", quality: 60 });
      // The model likes to stop on the review page; make it insist (two stops in a row) unless payment is on screen.
      const refuseStop: boolean = a.type === "stop" && !atPayment && !stopRefused;
      stopRefused = refuseStop;
      lastError = refuseStop
        ? "You chose stop, but no payment options are visible, so this is not the payment step. Continue towards payment. Stop only at payment or if the site demands phone/OTP/login."
        : "";
      if (!atPayment && a.type !== "stop") {
        try {
          await act(page, snap, a);
          await page.waitForLoadState("domcontentloaded").catch(() => {});
          await page.waitForTimeout(SETTLE_MS);
        } catch (e) {
          const msg = (e as Error).message;
          lastError = /intercepts pointer events/.test(msg)
            ? "That element is covered by a popup or overlay. Decline/close the popup first."
            : msg.split("\n")[0];
        }
      }
      const el = snap.elements.find((e) => e.id === a.target);
      history.push(`${i}. ${a.type}${a.target ? ` ${a.target}` : ""}${el ? ` ${JSON.stringify(el.text)}` : ""}${a.value ? ` = "${a.value}"` : ""}: ${a.reason}${lastError ? ` [FAILED: ${lastError}]` : ""}`);

      await opts.onStep?.({
        index: i,
        url: snap.url,
        page: name,
        action: a,
        targetText: el?.text ?? null,
        screenshot,
        newFindingsHint: pd,
        error: lastError || null,
        llm: { provider: llm.provider, model: llm.model, latencyMs },
      });

      if (atPayment) {
        reached = true;
        stopReason = "Reached payment step";
        break;
      }
      if (a.type === "stop" && !refuseStop) {
        stopReason = a.reason || "agent stopped";
        break;
      }
    }
  } finally {
    await browser.close();
    proxy?.close();
  }

  canonicaliseItems(steps);

  const journey = toJourney({
    reached_payment_page: reached,
    stop_reason: stopReason,
    items_added_by_agent: [...new Set(added.map((n) => matchAdded(n, steps)))],
    steps,
  });
  if (!journey) throw new Error("Agent produced an invalid journey");
  return { ...journey, stepsTaken };
}
