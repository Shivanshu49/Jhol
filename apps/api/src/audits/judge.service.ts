import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { buildJudgePrompt, parseJudge, type Finding, type JourneyResult } from "@jhol/core";

/**
 * LLM judge for wording-based dark patterns (confirm shaming, trick questions, disguised ads, forced action).
 * Optional: without ANTHROPIC_API_KEY it returns [] and the audit still completes with rule findings.
 * parseJudge() drops any finding whose quote the agent never captured, so the model can't invent evidence.
 */
@Injectable()
export class JudgeService {
  private readonly log = new Logger(JudgeService.name);

  constructor(private readonly config: ConfigService) {}

  async judge(journey: JourneyResult): Promise<Finding[]> {
    const key = this.config.get<string>("ANTHROPIC_API_KEY");
    if (!key) return [];
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: this.config.get<string>("JUDGE_MODEL") ?? "claude-haiku-5-5",
          max_tokens: 1500,
          messages: [{ role: "user", content: buildJudgePrompt(journey) }],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        this.log.warn(`Judge HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
        return [];
      }
      const data = (await res.json()) as { content?: { type: string; text?: string }[] };
      const text = (data.content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("\n");
      return parseJudge(text, journey);
    } catch (err) {
      this.log.warn(`Judge skipped: ${(err as Error).message}`);
      return [];
    }
  }
}
