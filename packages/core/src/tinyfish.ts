/**
 * Jhol × TinyFish — Agent API client (plain REST, no SDK needed).
 *
 * Serverless-friendly flow (works on Vercel, no long-running server):
 *   1. startJourneyRun(url)      → POST /v1/automation/run-async  → run_id right away
 *   2. getRun(run_id) every ~2s  → GET  /v1/runs/{id}             → status, streaming_url, result
 *   3. toJourney(run.result)     → typed JourneyResult for lib/detectors.ts
 *
 * Docs: https://docs.tinyfish.ai/agent-api/reference
 *       https://docs.tinyfish.ai/key-concepts/structured-output
 *
 * Env: TINYFISH_API_KEY — server-side only. Never prefix it with NEXT_PUBLIC_.
 */

/** Override with TINYFISH_API_BASE for a proxy (e.g. LiteLLM) or a local fake in tests. */
const agentBase = () => (process.env.TINYFISH_API_BASE ?? "https://agent.tinyfish.ai/v1").replace(/\/+$/, "");

/** Start session B this long after session A. The gap is what exposes countdowns that restart for every visitor. */
export const SESSION_B_DELAY_MS = 120_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LineItem = { label: string; amount: number | null };

/** One page the agent passed through. Shape is enforced by JOURNEY_SCHEMA below. */
export type JourneyStep = {
  page: string; // "home" | "product" | "cart" | "checkout" | "review" | "payment" | …
  total_shown: number | null; // price / total in ₹ visible on this page
  line_items: LineItem[]; // products, fees, donations, add-ons, discounts
  preselected: LineItem[]; // options already ticked before the agent touched anything
  urgency_texts: string[]; // timers, "only X left", "N people viewing"
  choice_texts: string[]; // accept AND decline wording of offers / upsells / popups
  popups: string[]; // popup or modal text seen on this page
};

export type JourneyResult = {
  reached_payment_page: boolean;
  stop_reason: string;
  items_added_by_agent: string[];
  steps: JourneyStep[];
};

export type RunStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export type TinyFishRun = {
  run_id: string;
  status: RunStatus;
  started_at: string | null;
  finished_at: string | null;
  num_of_steps: number | null; // = credits used by this run
  streaming_url: string | null; // live browser view while RUNNING → show it in the UI
  video_url: string | null; // run recording, if your account has it
  result: unknown;
  error: { code?: string; message?: string; help_message?: string; help_url?: string } | null;
};

export type RunOptions = {
  /** Stealth browser profile for real sites with bot protection. Default: lite. */
  stealth?: boolean;
  /** Route through an Indian IP so prices, fees and offers are the Indian ones. */
  indiaProxy?: boolean;
  /** Pincode the agent types if a site asks for one. */
  pincode?: string;
  /** HTTPS URL TinyFish calls on run lifecycle events (we treat it as a "check this run now" nudge). */
  webhookUrl?: string;
};

// ---------------------------------------------------------------------------
// What we ask the agent to do + the exact shape we want back
// ---------------------------------------------------------------------------

export function checkoutGoal(pincode = "110001"): string {
  return `You are a first-time shopper auditing this website's checkout for a consumer-protection report. Never buy anything.
1. Find the cheapest in-stock product and add exactly ONE unit to the cart.
2. Go through checkout as a guest. If asked, use name "Test User", email "test@example.com", pincode "${pincode}".
3. If a popup, offer or upsell appears, first note the exact wording of both its accept and decline options, then decline it.
4. Do NOT untick, remove or change anything the website added or pre-selected by itself.
5. If the site demands a phone number, OTP, login or account creation, stop there.
6. Stop when you reach the payment step. Never enter payment details and never place an order.

For EVERY page you pass through, add one entry to "steps":
- page: short page name (home, product, cart, checkout, review, payment, ...)
- total_shown: the price or order total shown on that page in rupees, as a plain number (null if none)
- line_items: every product, fee, charge, donation, add-on or discount listed, each with label and amount (plain number, no ₹ or commas)
- preselected: every checkbox, toggle or add-on that was ALREADY selected before you touched it, with label and amount
- urgency_texts: exact text of any timer, countdown, "only X left", "N people viewing" or similar
- choice_texts: exact text of the accept AND decline options of any offer, upsell or popup
- popups: exact text of any popup or modal that appeared on that page
Also return items_added_by_agent (only what YOU added), reached_payment_page and stop_reason.`;
}

const strings = { type: "array", items: { type: "string" } };
const lineItems = {
  type: "array",
  items: {
    type: "object",
    properties: {
      label: { type: "string" },
      amount: { type: "number", nullable: true },
    },
    required: ["label", "amount"],
  },
};

/** Only uses keywords TinyFish's structured output accepts (no additionalProperties / oneOf / const). Depth 6 of max 10. */
export const JOURNEY_SCHEMA = {
  type: "object",
  properties: {
    reached_payment_page: { type: "boolean" },
    stop_reason: { type: "string" },
    items_added_by_agent: strings,
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          page: { type: "string" },
          total_shown: { type: "number", nullable: true },
          line_items: lineItems,
          preselected: lineItems,
          urgency_texts: strings,
          choice_texts: strings,
          popups: strings,
        },
        required: ["page", "total_shown", "line_items", "preselected", "urgency_texts", "choice_texts", "popups"],
      },
    },
  },
  required: ["reached_payment_page", "stop_reason", "items_added_by_agent", "steps"],
};

// ---------------------------------------------------------------------------
// REST calls
// ---------------------------------------------------------------------------

function apiKey(): string {
  const key = process.env.TINYFISH_API_KEY;
  if (!key) throw new Error("TINYFISH_API_KEY is not set");
  return key;
}

async function tinyfish<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${agentBase()}${path}`, {
    method: init.method ?? "GET",
    headers: { "X-API-Key": apiKey(), "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`TinyFish ${res.status} on ${path}: ${text.slice(0, 400)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** Start one checkout-journey run. Returns TinyFish's run_id immediately. */
export async function startJourneyRun(url: string, opts: RunOptions = {}): Promise<string> {
  const body: Record<string, unknown> = {
    url,
    goal: checkoutGoal(opts.pincode),
    output_schema: JOURNEY_SCHEMA,
    browser_profile: opts.stealth ? "stealth" : "lite",
  };
  if (opts.indiaProxy) {
    body.proxy_config = { enabled: true, type: "tinyfish", country_code: "IN" };
  }
  if (opts.webhookUrl?.startsWith("https://")) {
    body.webhook_url = opts.webhookUrl; // TinyFish only accepts https webhooks
  }
  // Don't add agent_config.max_steps unless your account is in TinyFish's beta — it returns 403 otherwise.
  // Cap spend with cancelRun() from your poller instead.
  const res = await tinyfish<{ run_id: string | null; error: unknown }>("/automation/run-async", {
    method: "POST",
    body,
  });
  if (!res.run_id) throw new Error(`TinyFish did not create a run: ${JSON.stringify(res.error)}`);
  return res.run_id;
}

/** Poll this from your API route. Carries status, the live-view URL while running, and the result when done. */
export function getRun(runId: string): Promise<TinyFishRun> {
  return tinyfish<TinyFishRun>(`/runs/${encodeURIComponent(runId)}`);
}

/** Stop a run that's taking too long, so it stops eating credits. */
export function cancelRun(runId: string): Promise<{ run_id: string; status: string }> {
  return tinyfish(`/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Normalise whatever comes back into a safe JourneyResult
// ---------------------------------------------------------------------------

const toStrings = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);

const toNumber = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const m = v.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  }
  return null;
};

/** Accepts {label, amount} objects, or strings like "Platform fee | 19" / "Platform fee ₹19". */
export function toLineItem(v: unknown): LineItem {
  if (v && typeof v === "object") {
    const o = v as { label?: unknown; amount?: unknown };
    return { label: String(o.label ?? "").trim(), amount: toNumber(o.amount) };
  }
  const s = String(v ?? "").trim();
  const bar = s.lastIndexOf("|");
  if (bar >= 0) return { label: s.slice(0, bar).trim(), amount: toNumber(s.slice(bar + 1)) };
  const m = s.match(/^(.*?)[\s:–-]*(?:₹|rs\.?|inr)?\s*(-?[\d,]+(?:\.\d+)?)\s*$/i);
  return m ? { label: m[1].trim(), amount: toNumber(m[2]) } : { label: s, amount: null };
}

const toLineItems = (v: unknown): LineItem[] => (Array.isArray(v) ? v.map(toLineItem) : []);

/** TinyFish returns an object directly, or wraps a bare value under result.result — handles both. */
export function toJourney(result: unknown): JourneyResult | null {
  let r: unknown = result;
  if (r && typeof r === "object" && !("steps" in r) && "result" in r) {
    r = (r as { result: unknown }).result;
  }
  if (typeof r === "string") {
    try {
      r = JSON.parse(r);
    } catch {
      return null;
    }
  }
  if (!r || typeof r !== "object" || !Array.isArray((r as { steps?: unknown }).steps)) return null;

  const j = r as Record<string, unknown>;
  return {
    reached_payment_page: Boolean(j.reached_payment_page),
    stop_reason: String(j.stop_reason ?? ""),
    items_added_by_agent: toStrings(j.items_added_by_agent),
    steps: (j.steps as unknown[]).map((raw) => {
      const s = (raw ?? {}) as Record<string, unknown>;
      return {
        page: String(s.page ?? ""),
        total_shown: toNumber(s.total_shown),
        line_items: toLineItems(s.line_items),
        preselected: toLineItems(s.preselected),
        urgency_texts: toStrings(s.urgency_texts),
        choice_texts: toStrings(s.choice_texts),
        popups: toStrings(s.popups),
      };
    }),
  };
}
