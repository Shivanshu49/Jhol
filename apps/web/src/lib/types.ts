export type Severity = "high" | "medium" | "low";

export type Finding = {
  id: string;
  pattern: string;
  severity: Severity;
  page: string | null;
  evidence: string | null;
  detail: string | null;
  source: "rule" | "llm";
};

export type Run = {
  id: string;
  session: "A" | "B";
  status: string;
  streaming_url: string | null;
  video_url: string | null;
  num_steps: number | null;
  started_at: string | null;
  error: string | null;
  reached_payment_page: boolean | null;
  stop_reason: string | null;
  pages: string[];
};

export type Audit = {
  id: string;
  url: string;
  sessions: number;
  status: "running" | "finalizing" | "done" | "failed";
  error: string | null;
  price_shown: number | null;
  price_final: number | null;
  score: number | null;
  report_hash: string | null;
  created_at: string;
  finished_at: string | null;
};

export type AuditView = { audit: Audit; runs: Run[]; findings: Finding[] };

/** CCPA's 13 dark patterns (Guidelines for Prevention and Regulation of Dark Patterns, 2023). */
export const PATTERNS: Record<string, { label: string; what: string }> = {
  drip_pricing: { label: "Drip pricing", what: "Charges revealed only late in checkout" },
  basket_sneaking: { label: "Basket sneaking", what: "Items or add-ons the shopper never chose" },
  false_urgency: { label: "False urgency", what: "Fake timers or scarcity" },
  subscription_trap: { label: "Subscription trap", what: "Recurring plans slipped in" },
  confirm_shaming: { label: "Confirm shaming", what: "Guilt-tripping the 'no' option" },
  nagging: { label: "Nagging", what: "The same interruption again and again" },
  trick_question: { label: "Trick question", what: "Confusing wording that steers choices" },
  disguised_advertisement: { label: "Disguised ad", what: "Ads posing as normal content" },
  forced_action: { label: "Forced action", what: "Unrelated steps forced before buying" },
  interface_interference: { label: "Interface interference", what: "Design that hides the fair option" },
  bait_and_switch: { label: "Bait & switch", what: "Advertised offer swapped for another" },
  saas_billing: { label: "SaaS billing", what: "Silent recurring charges" },
  rogue_malware: { label: "Rogue malware", what: "Harmful software posing as legitimate" },
};

export const rupees = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
