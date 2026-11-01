# DevDay checks — 2026-11-01

## A — Passed

Three real OpenAI CLI runs reached payment with ₹499 → ₹606 and exactly two drip-pricing findings, two basket-sneaking findings, one subscription trap and one nagging finding. Times: 54.5s, 80.3s, 65.8s. The two-session run with `SESSION_B_DELAY_MS=60000` reached payment in both sessions and added two false-urgency findings (144.6s total). Raw counts are in `evals/agent-checks-2026-11-01.json`.

Payment submission is refused in code, including COD-only checkout. Screenshots now capture the page before the action so their page and price metadata match. Chromium's actual proxy path blocked a local target with HTTP 403.

## B — WIP: remote evidence schema

`pnpm turbo run build`, 14 core tests and 7 API e2e tests passed. The API e2e suite uses real Redis with a stub agent and in-memory database. Screenshot-upload failures retain the step row and failed-action reason. A missing steps table no longer makes the whole report return 500. The Dockerfile installs Chromium and its OS libraries; a Docker image build has not been run.

Three Supabase schema probes returned `PGRST205` for `run_steps`; the `screens` bucket is also missing. Run **`supabase/migrations/0003_agent_steps.sql`** in the Supabase SQL editor, then start a new audit to verify saved steps and screenshots. Earlier lost evidence cannot be recovered. The precedents table from migration 0002 is present. Service-role REST credentials do not provide a SQL execution endpoint.

Secret files remain ignored and are excluded from Docker builds. Nothing in the Jhol repository has been pushed.

The live two-session API audit `59858167-b86d-4223-9478-caeb65e11985` completed with both sessions reaching payment, ₹499 → ₹606, drip pricing ×2, basket sneaking ×2, subscription trap ×1, nagging ×1, false urgency ×1 and confirm shaming ×1. GET returned 200. Persisted step rows: 0, as expected until migration 0003.

## C — WIP: remote fix schema

Created the separate demo repository at `../chalak-mart`, served on port 5051, and published its initial main branch to https://github.com/Shivanshu49/chalak-mart as explicitly requested. Jhol was not pushed. Codex CLI 0.162.1 is installed and logged in. This version removed `--full-auto`; the worker uses the supported `--sandbox workspace-write` with `approval_policy="never"` and a ten-minute timeout.

The FIX job, guarded API endpoint, web proxy, progress states and receipts are implemented. Requests only apply to the exact configured demo URL and completed audits with findings. A database claim prevents duplicate fixes; a repository lock prevents concurrent branch edits. Codex receives findings through stdin and does not inherit application secrets. The job commits only index.html, publishes a PR when GitHub is available, re-audits the changed branch, requires a higher score and lower final price, then restores main. Without GitHub it retains the branch and diff summary locally.

Build, 14 core tests and 10 API e2e tests pass. Tests exercise a real local git repository, re-audit receipts, branch restoration, subprocess timeout, secret isolation and duplicate/unauthorized requests. The browser check passed request → progress → PR link → before/after receipts and checked stamp at desktop and mobile sizes. The report page changes are limited to the Fix component and the polling needed for it.

An initial live audit was interrupted by a development reload. Retried against a compiled API process: audit `a69ba9ac-5a83-49a0-8b8e-4db4ba5c9306` completed at ₹606, score 0. All three POST /fix checks returned 503 asking for **`supabase/migrations/0004_codex_fix.sql`**. Apply it after migration 0003, then repeat the persistent end-to-end check. The separate opt-in `apps/api/test/live-fix.cjs` check uses the real completed baseline, agent, judge, Codex, git, GitHub and Redis DB 14, with in-memory fix state and re-audit storage; its result is recorded separately and does not establish Supabase persistence.

## D — Passed

Ran `pnpm --filter @jhol/core eval --runs 3` against the original port-5050 store with the OpenAI agent and the same OpenAI judge used by the worker. Every audit reached payment. Donation, protection, subscription trap, confirm shaming, both hidden fees and nagging were caught in 3/3 runs. Timer and stock false urgency were 0/3 because this command uses one session; Step A separately verified the two-session check. Interface interference is marked not supported and excluded. Coverage: 18/24 supported case-runs (75%), average 18.7 steps and 60.4s. These are coverage results, not a measurement of false positives. Results: `evals/results-2026-11-01T07-52-40-904Z.json`. Build, 15 core tests and 10 API e2e tests pass.

## E — Skipped by the requested condition

CEREBRAS_API_KEY is empty or absent in apps/api/.env. No Cerebras request was made and no provider comparison is claimed. Provider selection, the --llm flag, gpt-oss-120b at https://api.cerebras.ai/v1, the compact snapshot and json_object fallback are already implemented. Measured OpenAI Step-A totals: 54.5s, 80.3s and 65.8s (two-session total: 144.6s). Cerebras total: not measured.

### C — Real Codex/GitHub result

The opt-in check passed with real Codex, git/GitHub, Redis, agent and judge. PR: https://github.com/Shivanshu49/chalak-mart/pull/1. Branch: `jhol-fix-a69ba9ac-mvxj0g9q`. Before: ₹606, score 0. After: ₹499, score 63. The repo was restored to main and the PR was not merged. `evals/fix-check-2026-11-01.json` records the result. Fix state and after-audit storage were in-memory, so the after-audit UUID is not available in the persistent dashboard. Cloud persistence is still WIP until migrations 0003/0004 are applied.

## F — Passed

README now covers the Playwright agent, Cerebras/OpenAI selection, shared OpenAI judge, Exa, netguard, Codex Fix, measured eval table, provider timing limits, all four SQL migrations and local commands. Documentation checks verified local links, migration paths and agreement with recorded eval numbers. The final required build, core and API checks are recorded below. Next.js generated apps/web/AGENTS.md during development; its documentation guidance was read and retained.

Final required checks: pnpm turbo run build passed; core tests 15/15; API e2e tests 10/10. The tracked-file secret scan and git diff --check passed. No Jhol push was performed. The demo PR is open, main is restored, and the store repository is clean. pnpm dev is running on web :3000 / API+worker :4000; the original test store remains on :5050 and the separate store is served on :5051.
