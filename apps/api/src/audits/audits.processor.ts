import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job, Queue } from "bullmq";
import {
  cancelRun,
  getRun,
  jholScore,
  runRuleDetectors,
  sealReport,
  startJourneyRun,
  toJourney,
} from "@jhol/core";
import { DbService, type RunRow } from "../common/db.service";
import {
  AUDIT_QUEUE,
  JOB,
  KEEP,
  TERMINAL,
  timing,
  type CheckRunJob,
  type FinalizeJob,
  type StartSessionJob,
} from "../common/queue";
import { JudgeService } from "./judge.service";

/**
 * The audit pipeline. Every step is idempotent, so retries and duplicate jobs are safe:
 *   start-session → check-run (poll every 5s, or nudged by TinyFish's webhook) → finalize
 */
@Processor(AUDIT_QUEUE, { concurrency: 5 })
export class AuditsProcessor extends WorkerHost {
  private readonly log = new Logger(AuditsProcessor.name);

  constructor(
    private readonly db: DbService,
    private readonly judge: JudgeService,
    private readonly config: ConfigService,
    @InjectQueue(AUDIT_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<string> {
    switch (job.name) {
      case JOB.START_SESSION:
        return this.startSession(job.data as StartSessionJob);
      case JOB.CHECK_RUN:
        return this.checkRun(job.data as CheckRunJob);
      case JOB.FINALIZE:
        return this.finalize((job.data as FinalizeJob).auditId);
      default:
        throw new Error(`Unknown job: ${job.name}`);
    }
  }

  // ---------------------------------------------------------------- start

  private async startSession({ auditId, session }: StartSessionJob): Promise<string> {
    const audit = await this.db.getAudit(auditId);
    if (!audit || audit.status !== "running") return "skipped: audit no longer running";

    const existing = (await this.db.getRuns(auditId)).find((r) => r.session === session);
    if (existing?.tinyfish_run_id) return "skipped: already started";

    const tinyfishRunId = await startJourneyRun(audit.url, { ...audit.options, webhookUrl: this.webhookUrl() });
    const run = await this.db.upsertRun({ audit_id: auditId, session, tinyfish_run_id: tinyfishRunId, status: "PENDING" });
    await this.enqueueCheck(run.id, 0, timing().firstCheckMs);
    this.log.log(`audit ${auditId} · session ${session} → TinyFish run ${tinyfishRunId}`);
    return tinyfishRunId;
  }

  private webhookUrl(): string | undefined {
    const base = this.config.get<string>("PUBLIC_API_URL");
    const secret = this.config.get<string>("WEBHOOK_SECRET");
    if (!base || !secret) return undefined;
    return `${base.replace(/\/+$/, "")}/webhooks/tinyfish?token=${encodeURIComponent(secret)}`;
  }

  // ---------------------------------------------------------------- poll

  private async checkRun({ runRowId, checks, oneShot }: CheckRunJob): Promise<string> {
    const run = await this.db.getRun(runRowId);
    if (!run?.tinyfish_run_id) return "skipped: no run";
    if (TERMINAL.has(run.status)) return "skipped: already finished";

    const tf = await getRun(run.tinyfish_run_id);
    const live: Partial<RunRow> = {
      status: tf.status,
      streaming_url: tf.streaming_url ?? run.streaming_url,
      video_url: tf.video_url ?? run.video_url,
      started_at: tf.started_at ?? run.started_at,
      num_steps: tf.num_of_steps ?? run.num_steps,
    };

    if (tf.status === "COMPLETED") {
      const journey = toJourney(tf.result);
      await this.db.updateRun(
        run.id,
        journey
          ? { ...live, result: journey }
          : { ...live, status: "FAILED", error: "TinyFish result did not match the journey schema" },
      );
      await this.enqueueFinalize(run.audit_id);
      return "completed";
    }

    if (tf.status === "FAILED" || tf.status === "CANCELLED") {
      await this.db.updateRun(run.id, { ...live, error: tf.error?.help_message ?? tf.error?.message ?? tf.status });
      await this.enqueueFinalize(run.audit_id);
      return tf.status.toLowerCase();
    }

    await this.db.updateRun(run.id, live);
    if (oneShot) return "nudged"; // webhook nudge: the regular polling chain keeps going

    if (checks >= timing().maxChecks) {
      await cancelRun(run.tinyfish_run_id).catch(() => undefined);
      await this.db.updateRun(run.id, { status: "FAILED", error: "Timed out; cancelled to save credits" });
      await this.enqueueFinalize(run.audit_id);
      return "timed out";
    }

    await this.enqueueCheck(run.id, checks + 1);
    return "still running";
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
      const report_hash = await sealReport({
        auditId,
        url: audit.url,
        drift,
        findings: all,
        tinyfishRuns: runs.map((r) => r.tinyfish_run_id),
      });

      await this.db.insertFindings(auditId, all);
      await this.db.finishAudit(auditId, {
        status: "done",
        price_shown: drift?.shown ?? null,
        price_final: drift?.final ?? null,
        score,
        report_hash,
      });
      this.log.log(`audit ${auditId} done · ${all.length} findings · score ${score}`);
      return "done";
    } catch (err) {
      await this.db.failAudit(auditId, `Finalize failed: ${(err as Error).message}`);
      throw err;
    }
  }

  // ---------------------------------------------------------------- helpers

  private enqueueCheck(runRowId: string, checks: number, delay = timing().pollEveryMs) {
    const data: CheckRunJob = { runRowId, checks };
    return this.queue.add(JOB.CHECK_RUN, data, { delay, attempts: 3, backoff: { type: "exponential", delay: 5_000 }, ...KEEP });
  }

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
        await this.db.upsertRun({
          audit_id: auditId,
          session,
          tinyfish_run_id: null,
          status: "FAILED",
          error: `Could not start TinyFish run: ${err.message}`,
        });
        await this.enqueueFinalize(auditId);
      } else if (job.name === JOB.CHECK_RUN) {
        const run = await this.db.getRun((job.data as CheckRunJob).runRowId);
        if (run && !TERMINAL.has(run.status)) {
          await this.db.updateRun(run.id, { status: "FAILED", error: `Lost track of the run: ${err.message}` });
          await this.enqueueFinalize(run.audit_id);
        }
      }
    } catch (e) {
      this.log.error(`Could not record failure of ${job.name} ${job.id}: ${(e as Error).message}`);
    }
  }
}
