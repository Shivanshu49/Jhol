/**
 * pnpm --filter @jhol/core agent <url> [--headed] [--twice] [--llm cerebras|openai]
 * Env comes from apps/api/.env (see the "agent" script); real env vars win.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { runJourney, type LlmProvider } from "./agent";
import { runRuleDetectors, type Session } from "./detectors";
import { SESSION_B_DELAY_MS } from "./journey";

const args = process.argv.slice(2);
const llmAt = args.indexOf("--llm");
const llm = llmAt >= 0 ? (args[llmAt + 1] as LlmProvider) : undefined; // validated by runJourney
const url = args.find((a, i) => !a.startsWith("--") && (llmAt < 0 || i !== llmAt + 1));
const headed = args.includes("--headed");
const twice = args.includes("--twice");
const latencies: number[] = [];

async function session(label: string, target: string): Promise<Session & { startedAt: Date }> {
  const startedAt = new Date();
  const dir = join("runs", startedAt.toISOString().replace(/[:.]/g, "-"));
  mkdirSync(dir, { recursive: true });
  console.log(`\n${label} · screenshots in ${dir}`);
  const result = await runJourney(target, {
    headless: !headed,
    allowPrivateNetwork: true, // local tool: the test store runs on localhost
    llm,
    onStep: (s) => {
      const n = String(s.index).padStart(2, "0");
      writeFileSync(join(dir, `step-${n}.jpg`), s.screenshot);
      latencies.push(s.llm.latencyMs);
      const a = s.action;
      const llmTag = `[${s.llm.provider} ${s.llm.model} ${s.llm.latencyMs}ms]`;
      console.log(`${n} ${llmTag} ${s.page.padEnd(10)} ${a.type}${a.target ? ` ${a.target}` : ""}${a.value ? ` "${a.value}"` : ""}: ${a.reason}${s.error ? ` [FAILED: ${s.error}]` : ""}`);
    },
  });
  writeFileSync(join(dir, "journey.json"), JSON.stringify(result, null, 2));
  console.log(`reached_payment_page: ${result.reached_payment_page} · stop_reason: ${result.stop_reason} · steps: ${result.stepsTaken} · ${Math.round((Date.now() - startedAt.getTime()) / 1000)}s`);
  return { result, startedAt };
}

async function main() {
  const started = Date.now();
  if (!url) {
    console.error("Usage: pnpm --filter @jhol/core agent <url> [--headed] [--twice] [--llm cerebras|openai]");
    process.exit(1);
  }
  const a = await session("Session A", url);
  let b: Session | undefined;
  if (twice) {
    const delay = Number(process.env.SESSION_B_DELAY_MS ?? SESSION_B_DELAY_MS);
    const wait = Math.max(0, delay - (Date.now() - a.startedAt.getTime())); // B starts `delay` ms after A started
    console.log(`\nWaiting ${Math.round(wait / 1000)}s before session B…`);
    await sleep(wait);
    b = await session("Session B", url);
  }

  const { findings, drift } = runRuleDetectors(a, b);
  console.log(
    drift
      ? `\nprice drift: ₹${drift.shown} (${drift.shownOn}) → ₹${drift.final} (${drift.finalOn}) · +₹${drift.extra} (+${drift.pct}%)`
      : "\nprice drift: none",
  );
  console.log(`findings (${findings.length}):`);
  for (const f of findings) console.log(`  [${f.severity}] ${f.pattern} @ ${f.page}: ${f.evidence}`);
  const avg = latencies.length ? Math.round(latencies.reduce((x, y) => x + y, 0) / latencies.length) : 0;
  console.log(`\ntotal time: ${((Date.now() - started) / 1000).toFixed(1)}s · avg step latency (LLM): ${avg}ms over ${latencies.length} steps`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
