import { Body, Controller, HttpCode, Post, Query, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectQueue } from "@nestjs/bullmq";
import { SkipThrottle } from "@nestjs/throttler";
import type { Queue } from "bullmq";
import { safeEqual } from "../common/api-key.guard";
import { DbService } from "../common/db.service";
import { AUDIT_QUEUE, JOB, KEEP, type CheckRunJob } from "../common/queue";

@Controller("webhooks")
@SkipThrottle()
export class WebhooksController {
  constructor(
    private readonly config: ConfigService,
    private readonly db: DbService,
    @InjectQueue(AUDIT_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * TinyFish run lifecycle notifications (we pass this URL as webhook_url when starting a run).
   * The payload is never trusted: it only tells us which run to re-check right now.
   * Polling stays the source of truth, so a missed webhook just means a few seconds' delay.
   */
  @Post("tinyfish")
  @HttpCode(200)
  async tinyfish(@Query("token") token: string | undefined, @Body() body: unknown) {
    if (!safeEqual(token ?? "", this.config.getOrThrow<string>("WEBHOOK_SECRET"))) throw new UnauthorizedException();

    const runId = findRunId(body);
    if (runId) {
      const run = await this.db.getRunByTinyfishId(runId);
      if (run) {
        const data: CheckRunJob = { runRowId: run.id, checks: 0, oneShot: true };
        await this.queue.add(JOB.CHECK_RUN, data, KEEP);
      }
    }
    return { ok: true };
  }
}

function findRunId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { run_id?: unknown; runId?: unknown; data?: { run_id?: unknown }; run?: { run_id?: unknown; id?: unknown } };
  const id = b.run_id ?? b.runId ?? b.data?.run_id ?? b.run?.run_id ?? b.run?.id;
  return typeof id === "string" ? id : null;
}
