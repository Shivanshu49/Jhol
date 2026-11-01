import OpenAI from "openai";
import { buildJudgePrompt, parseJudge, type Finding } from "./detectors";
import type { JourneyResult } from "./journey";

/** Shared by worker and evals. Agent provider selection never changes the OpenAI judge. */
export async function judgeJourney(journey: JourneyResult, options: { apiKey?: string; model?: string; baseURL?: string } = {}): Promise<Finding[]> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const model = options.model ?? process.env.OPENAI_MODEL;
  if (!apiKey || !model) throw new Error("The judge requires OPENAI_API_KEY and OPENAI_MODEL.");
  const client = new OpenAI({ apiKey, baseURL: options.baseURL || process.env.OPENAI_BASE_URL || undefined, timeout: 60_000 });
  const res = await client.chat.completions.create({
    model, max_completion_tokens: 1500,
    messages: [{ role: "user", content: buildJudgePrompt(journey) }],
  });
  return parseJudge(res.choices[0]?.message?.content ?? "", journey);
}
