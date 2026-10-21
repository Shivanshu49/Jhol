import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { DbService } from "../common/db.service";
import { AUDIT_QUEUE, JOB, KEEP, timing, type StartSessionJob } from "../common/queue";
import type { CreateAuditInput } from "./create-audit";

const RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const START_RETRY = { attempts: 5, backoff: { type: "exponential", delay: 30_000 } }; // rides out TinyFish 429s

@Injectable()
export class AuditsService {
  constructor(
    private readonly db: DbService,
    @InjectQueue(AUDIT_QUEUE) private readonly queue: Queue,
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

  /** Everything the dashboard needs for one audit. Raw agent results stay server-side. */
  async view(id: string) {
    const audit = await this.db.getAudit(id);
    if (!audit) return null;
    const [runs, findings] = await Promise.all([this.db.getRuns(id), this.db.getFindings(id)]);
    return {
      audit,
      runs: runs.map(({ result, ...run }) => ({
        ...run,
        reached_payment_page: result?.reached_payment_page ?? null,
        stop_reason: result?.stop_reason ?? null,
        pages: result?.steps.map((s) => s.page) ?? [],
      })),
      findings: [...findings].sort((x, y) => (RANK[x.severity] ?? 9) - (RANK[y.severity] ?? 9)),
    };
  }
}
