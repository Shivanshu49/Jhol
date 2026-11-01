import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { judgeJourney, type Finding, type JourneyResult } from "@jhol/core";

/**
 * LLM judge for wording-based dark patterns (confirm shaming, trick questions, disguised ads, forced action).
 * Always OpenAI (OPENAI_API_KEY, OPENAI_MODEL, optional OPENAI_BASE_URL), whatever AGENT_LLM the agent uses.
 * Optional: without OPENAI_API_KEY it returns [] and the audit still completes with rule findings.
 * parseJudge() drops any finding whose quote the agent never captured, so the model can't invent evidence.
 */
@Injectable()
export class JudgeService {
  private readonly log = new Logger(JudgeService.name);

  constructor(private readonly config: ConfigService) {}

  async judge(journey: JourneyResult): Promise<Finding[]> {
    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    const model = this.config.get<string>("OPENAI_MODEL");
    if (!apiKey || !model) return [];
    try {
      return await judgeJourney(journey, { apiKey, model, baseURL: this.config.get<string>("OPENAI_BASE_URL") });
    } catch (err) {
      this.log.warn(`Judge skipped: ${(err as Error).message}`);
      return [];
    }
  }
}
