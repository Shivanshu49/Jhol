# DevDay checks — 2026-11-01

## A — Passed

Three real OpenAI CLI runs reached payment with ₹499 → ₹606 and exactly two drip-pricing findings, two basket-sneaking findings, one subscription trap and one nagging finding. Times: 54.5s, 80.3s, 65.8s. The two-session run with `SESSION_B_DELAY_MS=60000` reached payment in both sessions and added two false-urgency findings (144.6s total). Raw counts are in `evals/agent-checks-2026-11-01.json`.

Payment submission is refused in code, including COD-only checkout. Screenshots now capture the page before the action so their page and price metadata match. Chromium's actual proxy path blocked a local target with HTTP 403.

## B — WIP: remote evidence schema

`pnpm turbo run build`, 14 core tests and 7 API e2e tests passed. The API e2e suite uses real Redis with a stub agent and in-memory database. Screenshot-upload failures retain the step row and failed-action reason. A missing steps table no longer makes the whole report return 500. The Dockerfile installs Chromium and its OS libraries; a Docker image build has not been run.

Three Supabase schema probes returned `PGRST205` for `run_steps`; the `screens` bucket is also missing. Run **`supabase/migrations/0003_agent_steps.sql`** in the Supabase SQL editor, then start a new audit to verify saved steps and screenshots. Earlier lost evidence cannot be recovered. The precedents table from migration 0002 is present. Service-role REST credentials do not provide a SQL execution endpoint.

Secret files remain ignored and are excluded from Docker builds. Nothing in the Jhol repository has been pushed.

The live two-session API audit `59858167-b86d-4223-9478-caeb65e11985` completed with both sessions reaching payment, ₹499 → ₹606, drip pricing ×2, basket sneaking ×2, subscription trap ×1, nagging ×1, false urgency ×1 and confirm shaming ×1. GET returned 200. Persisted step rows: 0, as expected until migration 0003.
