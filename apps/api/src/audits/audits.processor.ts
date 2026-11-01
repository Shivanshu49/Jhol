import { Inject, Logger } from "@nestjs/common";
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job, Queue } from "bullmq";
import {
  type AgentStepEvent,
  findPrecedents,
  jholScore,
  type Precedent,
  runJourney,
  runRuleDetectors,
  sealReport,
} from "@jhol/core";
import { DbService } from "../common/db.service";
import { AUDIT_QUEUE, JOB, KEEP, type FinalizeJob, type Session, TERMINAL, type StartSessionJob } from "../common/queue";
import { allowPrivateTargets } from "./create-audit";
import { JudgeService } from "./judge.service";
import { FixService } from "./fix.service";

const PRECEDENTS_TTL_MS = 24 * 60 * 60 * 1000; // search each pattern at most once a day

/** Provider token for the browser agent, so tests can swap in a stub. */
export const RUN_JOURNEY = "RUN_JOURNEY";
export type RunJourney = typeof runJourney;

/** "click "Add to cart"", "fill "Email" = "test@example.com"", "stop" — what the step log shows. */
const describe = (s: AgentStepEvent) =>
  [s.action.type, s.targetText && JSON.stringify(s.targetText), s.action.value && `= ${JSON.stringify(s.action.value)}`]
    .filter(Boolean)
    .join(" ");

/**
 * The audit pipeline. Every step is idempotent, so retries and duplicate jobs are safe:
 *   start-session (runs the browser agent in this process, ~1 min) → finalize
 * lockDuration covers a whole agent run; BullMQ renews the lock while the job is alive.
 */
@Processor(AUDIT_QUEUE, { concurrency: 5, lockDuration: 120_000 })
export class AuditsProcessor extends WorkerHost {
  private readonly log = new Logger(AuditsProcessor.name);

  constructor(
    private readonly db: DbService,
    private readonly judge: JudgeService,
    @Inject(RUN_JOURNEY) private readonly runJourney: RunJourney,
    @InjectQueue(AUDIT_QUEUE) private readonly queue: Queue,
    private readonly fixer: FixService,
  ) {
    super();
  }

  async process(job: Job): Promise<string> {
    switch (job.name) {
      case JOB.START_SESSION:
        return this.startSession(job.data as StartSessionJob);
      case JOB.FINALIZE:
        return this.finalize((job.data as FinalizeJob).auditId);
      case JOB.FIX:
        return this.fixer.run((job.data as FinalizeJob).auditId);
      default:
        throw new Error(`Unknown job: ${job.name}`);
    }
  }

  // ---------------------------------------------------------------- run the agent

  private async startSession({ auditId, session }: StartSessionJob): Promise<string> {
    const audit = await this.db.getAudit(auditId);
    if (!audit || audit.status !== "running") return "skipped: audit no longer running";

    const existing = (await this.db.getRuns(auditId)).find((r) => r.session === session);
    if (existing && TERMINAL.has(existing.status)) {
      await this.enqueueFinalize(auditId);
      return "skipped: already finished";
    }

    const run = await this.db.upsertRun({ audit_id: auditId, session, status: "RUNNING", started_at: new Date().toISOString(), error: null });
    this.log.log(`audit ${auditId} · session ${session} → agent on ${audit.url}`);
    let outcome: string;
    try {
      const { stepsTaken, ...journey } = await this.runJourney(audit.url, {
        pincode: audit.options.pincode,
        allowPrivateNetwork: allowPrivateTargets(),
        onStep: (step) => this.saveStep(auditId, session, run.id, step),
      });
      await this.db.updateRun(run.id, { status: "COMPLETED", result: journey, num_steps: stepsTaken });
      outcome = `completed in ${stepsTaken} steps`;
    } catch (err) {
      await this.db.updateRun(run.id, { status: "FAILED", error: (err as Error).message });
      outcome = `failed: ${(err as Error).message}`;
    }
    await this.enqueueFinalize(auditId);
    return outcome;
  }

  /** Live step log + screenshot. Never throws: a lost screenshot must not fail the audit. */
  private async saveStep(auditId: string, session: Session, runId: string, step: AgentStepEvent): Promise<void> {
    const path = `${auditId}/${session}/${step.index}.jpg`;
    let screenshotPath: string | null = null;
    try {
      await this.db.uploadScreenshot(path, step.screenshot);
      screenshotPath = path;
    } catch (e) {
      this.log.warn(`screenshot ${step.index} of ${auditId}/${session} not saved: ${(e as Error).message}`);
    }
    try {
      await this.db.upsertStep({
        run_id: runId,
        idx: step.index,
        page: step.page,
        action: describe(step),
        reason: [step.action.reason, step.error ? `Action failed: ${step.error}` : null].filter(Boolean).join(" · "),
        screenshot_path: screenshotPath,
        total_shown: step.newFindingsHint.total_shown,
      });
    } catch (e) {
      this.log.warn(`step ${step.index} of ${auditId}/${session} not saved: ${(e as Error).message}`);
    }
  }

  // ---------------------------------------------------------------- finalize

  private async finalize(auditId: string): Promise<string> {
    const audit = await this.db.getAudit(auditId);
    if (!audit || audit.status !== "running") return "skipped";

    const runs = await this.db.getRuns(auditId);
    const a = runs.find((r) => r.session === "A");
    const b = runs.find((r) => r.session === "B");

    if (!a || !TERMINAL.has(a.status)) return "waiting for session A";
    if (a.status !== "COMPLETED" || !a.result) {
      if (await this.db.claimAudit(auditId)) await this.db.failAudit(auditId, a.error ?? "Session A did not complete");
      return "failed";
    }
    if (audit.sessions === 2 && (!b || !TERMINAL.has(b.status))) return "waiting for session B";
    if (!(await this.db.claimAudit(auditId))) return "already finalized";

    try {
      const A = { result: a.result, startedAt: a.started_at ?? a.created_at };
      const B =
        b?.status === "COMPLETED" && b.result ? { result: b.result, startedAt: b.started_at ?? b.created_at } : undefined;

      const { findings, drift } = runRuleDetectors(A, B);
      const llmFindings = await this.judge.judge(a.result);
      const all = [...findings, ...llmFindings];
      const score = jholScore(all);
      const precedents = await this.precedents([...new Set(all.map((f) => f.pattern))]);
      const report_hash = await sealReport({
        auditId,
        url: audit.url,
        drift,
        findings: all,
        runs: runs.map((r) => ({ session: r.session, started_at: r.started_at, num_steps: r.num_steps })),
      });

      await this.db.insertFindings(auditId, all);
      await this.db.finishAudit(auditId, {
        status: "done",
        price_shown: drift?.shown ?? null,
        price_final: drift?.final ?? null,
        score,
        report_hash,
        precedents,
      });
      this.log.log(`audit ${auditId} done · ${all.length} findings · score ${score}`);
      return "done";
    } catch (err) {
      await this.db.failAudit(auditId, `Finalize failed: ${(err as Error).message}`);
      throw err;
    }
  }

  /** Up to 3 news/government precedents per pattern, cached in Supabase for a day. Never throws: no precedents is fine. */
  private async precedents(patterns: string[]): Promise<Record<string, Precedent[]>> {
    const out: Record<string, Precedent[]> = {};
    await Promise.all(
      patterns.map(async (pattern) => {
        try {
          const cached = await this.db.getPrecedents(pattern).catch(() => null);
          const fresh = cached !== null && Date.now() - Date.parse(cached.fetched_at) < PRECEDENTS_TTL_MS;
          const results = fresh ? cached.results : await findPrecedents(pattern);
          if (!fresh) {
            await this.db.savePrecedents(pattern, results).catch((e: Error) => this.log.warn(`precedents cache (${pattern}): ${e.message}`));
          }
          if (results.length) out[pattern] = results;
        } catch (e) {
          this.log.warn(`no precedents for ${pattern}: ${(e as Error).message}`);
        }
      }),
    );
    return out;
  }

  // ---------------------------------------------------------------- helpers

  private enqueueFinalize(auditId: string) {
    const data: FinalizeJob = { auditId };
    return this.queue.add(JOB.FINALIZE, data, { attempts: 3, backoff: { type: "exponential", delay: 10_000 }, ...KEEP });
  }

  /** When a job runs out of retries, record it so the audit never hangs in "running". */
  @OnWorkerEvent("failed")
  async onFailed(job: Job | undefined, err: Error) {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    this.log.warn(`${job.name} ${job.id} failed (${job.attemptsMade}/${attempts}): ${err.message}`);
    if (job.attemptsMade < attempts) return;

    try {
      if (job.name === JOB.START_SESSION) {
        const { auditId, session } = job.data as StartSessionJob;
        await this.db.upsertRun({ audit_id: auditId, session, status: "FAILED", error: `Agent run failed: ${err.message}` });
        await this.enqueueFinalize(auditId);
      } else if (job.name === JOB.FIX) {
        await this.db.updateFix((job.data as FinalizeJob).auditId, { fix_status: "failed", fix_error: err.message });
      }
    } catch (e) {
      this.log.error(`Could not record failure of ${job.name} ${job.id}: ${(e as Error).message}`);
    }
  }
}
