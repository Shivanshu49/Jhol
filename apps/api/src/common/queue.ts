import { SESSION_B_DELAY_MS } from "@jhol/core";

export const AUDIT_QUEUE = "audits";

export const JOB = {
  START_SESSION: "start-session", // start one TinyFish run (session A now, B ~2 min later)
  CHECK_RUN: "check-run", // poll a TinyFish run until it finishes
  FINALIZE: "finalize", // all sessions done → detectors + LLM judge → findings + sealed report
} as const;

export type Session = "A" | "B";
export type StartSessionJob = { auditId: string; session: Session };
export type CheckRunJob = { runRowId: string; checks: number; oneShot?: boolean };
export type FinalizeJob = { auditId: string };

export const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export const KEEP = { removeOnComplete: 1000, removeOnFail: 1000 };

const num = (value: string | undefined, fallback: number) =>
  value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : fallback;

/** Defaults are production values; env overrides exist for tests and demos. */
export function timing() {
  return {
    sessionBDelayMs: num(process.env.SESSION_B_DELAY_MS, SESSION_B_DELAY_MS), // gap the false-urgency test relies on
    firstCheckMs: num(process.env.FIRST_CHECK_MS, 10_000),
    pollEveryMs: num(process.env.POLL_EVERY_MS, 5_000),
    maxChecks: num(process.env.MAX_CHECKS, 180), // ~15 min of polling, then the run is cancelled to save credits
  };
}
