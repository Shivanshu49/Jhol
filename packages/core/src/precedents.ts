/**
 * Legal precedents for a finding: news / government pages where Indian regulators (CCPA) acted on the same
 * dark pattern. Env: EXA_API_KEY. Throws when Exa is unavailable; callers carry on without precedents.
 */
import { Exa } from "exa-js";

export type Precedent = { title: string; url: string; publishedDate?: string; snippet: string };

const PHRASES: Record<string, string> = {
  drip_pricing: "drip pricing hidden fees",
  basket_sneaking: "basket sneaking pre-selected donation",
  false_urgency: "false urgency fake countdown timer",
  subscription_trap: "subscription trap free trial auto-renewal",
  confirm_shaming: "confirm shaming guilt-tripping decline option",
  nagging: "nagging repeated pop-ups",
  interface_interference: "interface interference misleading design",
  trick_question: "trick question confusing opt-out",
  disguised_advertisement: "disguised advertisement",
  forced_action: "forced action mandatory sign-up",
  bait_and_switch: "bait and switch",
  saas_billing: "SaaS billing silent recurring charges",
  rogue_malware: "rogue malware",
};

/** Government sources and news outlets that report CCPA actions. Searched first. */
const TRUSTED_DOMAINS = [
  "consumeraffairs.nic.in", "doca.gov.in", "pib.gov.in", "egazette.gov.in", "ncdrc.nic.in",
  "economictimes.indiatimes.com", "timesofindia.indiatimes.com", "livemint.com", "thehindu.com",
  "thehindubusinessline.com", "indianexpress.com", "business-standard.com", "hindustantimes.com",
  "financialexpress.com", "moneycontrol.com", "ndtv.com", "reuters.com", "medianama.com", "livelaw.in", "barandbench.com",
];

const DAY_MS = 24 * 60 * 60 * 1000;
const memo = new Map<string, { at: number; results: Precedent[] }>();

export const precedentQuery = (pattern: string) =>
  `CCPA India penalty notice ${PHRASES[pattern] ?? pattern.replace(/_/g, " ")} dark pattern e-commerce`;

/** Top 3 precedents for a pattern. Cached in memory for a day; failures are not cached. */
export async function findPrecedents(pattern: string, exa?: Pick<Exa, "search">): Promise<Precedent[]> {
  const hit = memo.get(pattern);
  if (hit && Date.now() - hit.at < DAY_MS) return hit.results;
  if (!exa) {
    const key = process.env.EXA_API_KEY;
    if (!key) throw new Error("EXA_API_KEY is not set");
    exa = new Exa(key);
  }

  const query = precedentQuery(pattern);
  const contents = { highlights: { maxCharacters: 300 } };
  const req = { timeout: 8000 };
  const found = (await exa.search(query, { numResults: 3, includeDomains: TRUSTED_DOMAINS, contents }, req)).results;
  if (found.length < 3) found.push(...(await exa.search(query, { numResults: 3, category: "news", contents }, req)).results);

  const results: Precedent[] = [];
  for (const r of found) {
    if (results.length === 3) break;
    if (!/^https?:\/\//i.test(r.url) || results.some((p) => p.url === r.url)) continue; // no javascript: links, no dupes
    results.push({
      title: (r.title || r.url).trim(),
      url: r.url,
      publishedDate: r.publishedDate,
      snippet: (r.highlights ?? []).join(" … ").replace(/\s+/g, " ").trim().slice(0, 240),
    });
  }
  memo.set(pattern, { at: Date.now(), results });
  return results;
}
