import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { runJourney } from "./agent";
import { runRuleDetectors, type Finding, type Session } from "./detectors";
import { SESSION_B_DELAY_MS, type JourneyResult } from "./journey";
import { judgeJourney } from "./judge";

type Planted = { id: string; pattern: string; what: string };
type EvalRun = {
  run: number; seconds: number; steps: number; reachedPayment: boolean; provider: string; model: string;
  findings: Finding[]; journeys: JourneyResult[]; error: string | null;
};

/** Ground-truth cases with the same pattern still need their own evidence. */
export function caseCaught(id: string, findings: Finding[]): boolean {
  const has = (pattern: string, text?: RegExp) => findings.some((f) => f.pattern === pattern && (!text || text.test(`${f.evidence} ${f.detail}`)));
  switch (id) {
    case "P1": return has("false_urgency", /countdown|timer|deadline|deal ends/i);
    case "P2": return has("false_urgency", /stock|only \d+ left/i);
    case "P3": return has("basket_sneaking", /donation/i);
    case "P4": return has("basket_sneaking", /protection/i);
    case "P5": return has("subscription_trap");
    case "P6": return has("confirm_shaming");
    case "P7": return false; // Vision is not implemented; excluded from the supported-case denominator.
    case "P8": return has("drip_pricing", /platform/i) && has("drip_pricing", /handling/i);
    case "P9": return has("nagging");
    default: throw new Error(`No evaluator for ground-truth case ${id}`);
  }
}

export function summarize(planted: Planted[], runs: EvalRun[]) {
  const cases = planted.map((p) => ({
    id: p.id, pattern: p.pattern, supported: p.id !== "P7",
    caught: p.id === "P7" ? null : runs.filter((r) => caseCaught(p.id, r.findings)).length,
    runs: runs.length,
  }));
  const caught = cases.reduce((n, p) => n + (p.caught ?? 0), 0);
  const possible = cases.filter((p) => p.supported).length * runs.length;
  return { cases, caught, possible, catchRate: possible ? Math.round(caught / possible * 1000) / 10 : 0,
    averageSteps: Math.round(runs.reduce((n, r) => n + r.steps, 0) / runs.length * 10) / 10,
    averageSeconds: Math.round(runs.reduce((n, r) => n + r.seconds, 0) / runs.length * 10) / 10 };
}

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf("--runs");
  const count = at < 0 ? 3 : Number(args[at + 1]);
  if (!Number.isInteger(count) || count < 1) throw new Error("Usage: eval [--runs <positive integer>] [--twice]");
  const twice = args.includes("--twice");
  const delay = Number(process.env.SESSION_B_DELAY_MS ?? SESSION_B_DELAY_MS);
  if (twice && (!Number.isFinite(delay) || delay < 0)) throw new Error("SESSION_B_DELAY_MS must be a non-negative number");
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL) throw new Error("Evals require OPENAI_API_KEY and OPENAI_MODEL for the wording judge.");
  const truth = JSON.parse(readFileSync(resolve(__dirname, "../../../apps/web/public/lab/ground-truth.json"), "utf8")) as { planted: Planted[] };
  const url = "http://localhost:5050/chalak-mart.html";
  const runs: EvalRun[] = [];
  for (let i = 1; i <= count; i++) {
    const started = Date.now();
    let steps = 0, provider = "", model = "";
    const journeys: JourneyResult[] = [];
    let findings: Finding[] = [], error: string | null = null, reachedPayment = false;
    console.log(`Eval ${i}/${count}: ${twice ? "two sessions" : "one session"}`);
    const session = async (): Promise<Session> => {
      const startedAt = new Date();
      const { stepsTaken, ...result } = await runJourney(url, { allowPrivateNetwork: true,
        onStep: (event) => { provider = event.llm.provider; model = event.llm.model; } });
      steps += stepsTaken;
      journeys.push(result);
      return { result, startedAt };
    };
    try {
      const a = await session();
      let b: Session | undefined;
      if (twice) {
        await sleep(Math.max(0, delay - (Date.now() - started)));
        b = await session();
      }
      findings = [...runRuleDetectors(a, b).findings, ...await judgeJourney(a.result)];
      reachedPayment = journeys.every((j) => j.reached_payment_page);
    } catch (e) {
      error = (e as Error).message;
      for (const secret of [process.env.OPENAI_API_KEY, process.env.CEREBRAS_API_KEY]) if (secret) error = error.split(secret).join("[redacted]");
      console.error(`Eval ${i} failed: ${error}`);
    }
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    runs.push({ run: i, seconds, steps, reachedPayment, provider, model, findings, journeys, error });
    console.log(`Eval ${i}: payment=${reachedPayment}, ${steps} steps, ${seconds}s, ${findings.length} findings`);
  }
  const summary = summarize(truth.planted, runs);
  console.table(summary.cases.map((p) => ({ case: p.id, pattern: p.pattern, caught: p.supported ? `${p.caught}/${p.runs}` : "not supported" })));
  console.log(`Overall: ${summary.caught}/${summary.possible} supported case-runs (${summary.catchRate}%). Average: ${summary.averageSteps} steps, ${summary.averageSeconds}s per audit.`);
  if (!twice) console.log("Single-session evaluation: P1/P2 false urgency require --twice; their uncaught cases remain in the supported denominator.");
  const dir = resolve(__dirname, "../../../evals");
  mkdirSync(dir, { recursive: true });
  const timestamp = new Date().toISOString();
  const file = resolve(dir, `results-${timestamp.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({ timestamp, url, twice, sessionBDelayMs: twice ? delay : null, ...summary, runs }, null, 2) + "\n");
  console.log(`Results: ${file}`);
  if (runs.some((r) => r.error || !r.reachedPayment)) process.exitCode = 1;
}

if (require.main === module) main().catch((e) => { console.error((e as Error).message); process.exitCode = 1; });
