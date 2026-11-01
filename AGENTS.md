# Jhol — notes for coding agents

Jhol shops an e-commerce site like a real customer (never pays), records every checkout page as structured data, and flags dark patterns from India's CCPA 2023 guidelines with the exact text as evidence. Codex then fixes the store's code.

## Layout
- packages/core — agent (Playwright + OpenAI API), page snapshot, journey types, detectors (detectors.ts), CLI and evals. Shared by api and worker.
- apps/api — NestJS. One codebase, ROLE=api|worker|all. BullMQ queue "audits": START_SESSION → FINALIZE (+ FIX). Supabase via DbService.
- apps/web — Next.js 16 + Tailwind v4. Browser never calls the API directly; server actions / route handlers proxy with JHOL_API_KEY.
- supabase/migrations — SQL migrations, numbered.
- apps/web/public/lab/chalak-mart.html — fictional test store with 9 planted dark patterns; ground truth in ground-truth.json.

## Rules
- JourneyResult (packages/core/src/journey.ts) is the contract between the agent and the detectors. Don't change its shape.
- Don't edit detectors.ts unless the task says so; its tests must keep passing.
- The agent must never enter card, CVV, UPI, OTP or password data and must stop at the payment step.
- Secrets only via env (OPENAI_API_KEY, CEREBRAS_API_KEY, EXA_API_KEY, SUPABASE_*, JHOL_API_KEY). Never log them.
- Agent LLM: AGENT_LLM=cerebras|openai (default cerebras; CLI flag --llm). The LLM judge always uses OpenAI.
- Use child_process with argument arrays, never shell strings built from user input.
- TypeScript strict. Run before finishing: pnpm turbo run build && pnpm --filter @jhol/core test && pnpm --filter @jhol/api test:e2e

## Run locally
- npx serve apps/web/public/lab -l 5050   (test store)
- docker compose up -d                    (Redis)
- pnpm dev                                (web :3000, api+worker :4000)
- pnpm --filter @jhol/core agent http://localhost:5050/chalak-mart.html --headed
