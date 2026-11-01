import { SESSION_B_DELAY_MS } from "@jhol/core";

export const AUDIT_QUEUE = "audits";

export const JOB = {
  START_SESSION: "start-session", // run the browser agent once (session A now, B ~2 min later)
  FINALIZE: "finalize", // all sessions done → detectors + LLM judge → findings + sealed report
  FIX: "fix",
} as const;

export type Session = "A" | "B";
export type StartSessionJob = { auditId: string; session: Session };
export type FinalizeJob = { auditId: string };
export type FixJob = { auditId: string };

export const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export const KEEP = { removeOnComplete: 1000, removeOnFail: 1000 };

const num = (value: string | undefined, fallback: number) =>
  value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : fallback;

/** Defaults are production values; env overrides exist for tests and demos. */
export function timing() {
  return {
    sessionBDelayMs: num(process.env.SESSION_B_DELAY_MS, SESSION_B_DELAY_MS), // gap the false-urgency test relies on
  };
}
