import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { DbService } from "../common/db.service";
import { AUDIT_QUEUE, JOB, KEEP, timing, type StartSessionJob } from "../common/queue";
import type { CreateAuditInput } from "./create-audit";

const RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const START_RETRY = { attempts: 3, backoff: { type: "exponential", delay: 10_000 } }; // agent errors are caught; this rides out Supabase/Redis blips

@Injectable()
export class AuditsService {
  constructor(
    private readonly db: DbService,
    @InjectQueue(AUDIT_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  /** Creates the audit and schedules session A now and session B ~2 min later (false-urgency test). */
  async create(input: CreateAuditInput) {
    const audit = await this.db.createAudit(input);

    const a: StartSessionJob = { auditId: audit.id, session: "A" };
    await this.queue.add(JOB.START_SESSION, a, { jobId: `start-${audit.id}-A`, ...START_RETRY, ...KEEP });

    if (input.sessions === 2) {
      const b: StartSessionJob = { auditId: audit.id, session: "B" };
      await this.queue.add(JOB.START_SESSION, b, {
        jobId: `start-${audit.id}-B`,
        delay: timing().sessionBDelayMs,
        ...START_RETRY,
        ...KEEP,
      });
    }
    return audit;
  }

  list() {
    return this.db.listAudits();
  }

  async requestFix(id: string) {
    const audit = await this.db.getAudit(id);
    if (!audit) throw new NotFoundException("Audit not found");
    const repo = this.config.get<string>("FIX_REPO_PATH");
    const url = this.config.get<string>("FIX_STORE_URL");
    if (!repo || !url) throw new ServiceUnavailableException("Codex Fix is not configured on this server.");
    if (audit.url !== url) throw new BadRequestException("Codex Fix is only available for the configured demo store.");
    if (audit.status !== "done") throw new ConflictException("Wait for the audit to finish before fixing it.");
    if (audit.fix_status && audit.fix_status !== "failed") return { fix_status: audit.fix_status };
    if (!(await this.db.getFindings(id)).length) throw new BadRequestException("This audit has no findings to fix.");
    if (!(await this.db.claimFix(id))) throw new ConflictException("A fix has already been requested.");
    try {
      await this.queue.add(JOB.FIX, { auditId: id }, { jobId: `fix-${id}-${Date.now()}`, attempts: 1, ...KEEP });
    } catch (e) {
      await this.db.updateFix(id, { fix_status: "failed", fix_error: "Could not queue the fix. Retry when Redis is available." });
      throw e;
    }
    return { fix_status: "queued" };
  }

  /** Everything the dashboard needs for one audit. Raw agent results stay server-side. */
  async view(id: string) {
    const audit = await this.db.getAudit(id);
    if (!audit) return null;
    const [runs, findings] = await Promise.all([this.db.getRuns(id), this.db.getFindings(id)]);
    const steps = await this.db.getSteps(runs.map((r) => r.id));
    const { precedents, ...rest } = audit;
    const fixed = audit.fixed_audit_id ? await this.db.getAudit(audit.fixed_audit_id) : null;
    return {
      audit: rest,
      runs: runs.map(({ result, ...run }) => ({
        ...run,
        reached_payment_page: result?.reached_payment_page ?? null,
        stop_reason: result?.stop_reason ?? null,
        pages: result?.steps.map((s) => s.page) ?? [],
        steps: steps
          .filter((s) => s.run_id === run.id)
          .map(({ run_id, screenshot_path, ...s }) => ({ ...s, screenshot_url: screenshot_path ? this.db.screenshotUrl(screenshot_path) : null })),
      })),
      findings: [...findings].sort((x, y) => (RANK[x.severity] ?? 9) - (RANK[y.severity] ?? 9)),
      precedents: precedents ?? {}, // { [pattern]: [{ title, url, publishedDate?, snippet }] }
      fix_available: Boolean(this.config.get("FIX_REPO_PATH") && this.config.get("FIX_STORE_URL") === audit.url && audit.status === "done" && findings.length),
      fix_after: fixed ? { id: fixed.id, status: fixed.status, score: fixed.score, price_final: fixed.price_final } : null,
    };
  }
}
