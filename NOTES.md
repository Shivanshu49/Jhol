# DevDay checks — 2026-11-01

## Latest: publication, CI and two-session eval

The user subsequently authorized pushing Jhol to GitHub. Verified code is published on `devday`; earlier "no push" statements below describe their respective checks. The separate store remains on clean main, with no new store push in these follow-up checks.

CI commit `e5a346b` adds `playwright install --with-deps chromium` directly after the build. GitHub Actions run `41295688297` passed the build, Chromium installation, all 18 core tests and all 11 API e2e tests, including the previously unreached API step.

Completed `pnpm --filter @jhol/core eval --runs 3 --twice` once, with the standard 120,000ms session-start gap: 23/24 supported case-runs (95.8%), average 37.7 steps and 188.6s per pair, all six visits reached payment at ₹499 → ₹606. Countdown, donation, protection, subscription, confirm shaming, both fees and nagging were 3/3; stock was 2/3; visual interference remains unsupported. Stock samples: 3 → 3, 5 → 2 (low-confidence change warning), 4 → 5. Run 2 also flagged the shopper's tee incorrectly because its added-item evidence was missing. No resampling or precision claim: the limitation is retained in the README and raw JSON. Results: `evals/results-2026-11-01T10-03-27-498Z.json`.

## Follow-up: real Supabase and UI verification

Migrations 0003 and 0004 are now applied. The earlier migration-related WIP entries below describe the initial checks, before the SQL was applied.

The new two-session audit `3489e4f9-5f98-41a3-8c39-978e58a8d883` was created with the actual landing-page form while `pnpm dev` was running. Both visits reached payment; price was ₹499 → ₹606. Findings: drip pricing ×2, basket sneaking ×2, subscription trap ×1, false urgency ×2, nagging ×1, confirm shaming ×1. All 39 `run_steps` rows have screenshots; all 39 public JPEG downloads passed. The evidence viewer displayed the saved screenshots after reloading, and selecting a recorded step changed the displayed screenshot. Browser requests went through the Next.js proxy. No browser errors were recorded. Raw proof: `evals/verification/ui-2026-11-01T08-30-39-980Z.json` and the corresponding evidence PNG.

Automatic publication now requires `FIX_PUBLISH_PR=true`; it defaults to false. This session uses false to honor the instruction never to push. The fix integration test uses a GitHub-shaped fetch origin and a temporary bare push destination and verifies that no remote refs are created. A new fix can still commit its branch, persist its re-audit and display before/after receipts locally.

Required checks after the evidence viewer and publishing guard: build passed, core tests 15/15, API e2e tests 10/10. The first browser setup attempt timed out on Next.js development traffic before submitting an audit; the harness now waits for page content instead of network idle.

The first port-5051 baseline audit, `23c3f131-e57f-46ed-bf68-587c3449011f`, failed on saving its journey with PostgreSQL's `unsupported Unicode escape sequence`. It never started FIX. Model replies now replace NUL and invalid surrogate characters before validation and use, preserving valid rupee/emoji text and literal escaped strings. A regression test covers those cases. The failed attempt is retained in the verification records instead of being counted as a successful audit.

The retry `383af613-ba90-42bb-aa46-6af932802a78` was created through the landing page, and FIX was triggered with the actual report button. Real Codex committed `e4f6cd2` on local branch `jhol-fix-383af613-mvxl26je`. Supabase saved `fixed_audit_id=0d1a31a8-5b8f-432c-973d-039a31544a1e`: score 3 → 55, price ₹606 → ₹499, payment reached. There are 17 baseline screenshots and 13 re-audit screenshots, all downloadable. No new PR was published.

There was a long host-clock gap during this run and BullMQ logged lost Redis leases for FIX and START_SESSION. The UI harness timed out; the re-audit nevertheless persisted. GET now conditionally recovers a fix left `rechecking` from its completed linked audit, using the same score/price requirements. It never reruns Codex or publishes. A regression test covers unfinished, improved and unchanged results. Reopening the actual report recovered and persisted `done`; both receipts and CHECKED BY JHOL displayed after reload. Proof: `evals/verification/ui-2026-11-01T09-37-20-716Z.json`. The sibling repository was clean and on main afterward. Required checks: build passed, core 16/16, API 11/11.

Existing PR #1 was verified read-only at published commit `e55f4a9b08197b44b3556bb950ac7297f30ed567`. Its exact code was served on 5051 and audited through the UI as `b8eab4e7-a75b-4ab2-9b42-540744e25dfe` (₹499, score 55; all 11 screenshots stored/downloaded). The original before-audit's missing in-memory PR metadata was explicitly recovered into Supabase and linked to this fresh persisted re-audit. This was a metadata recovery, not a new PR publication or a worker-created PR in this session. The real PR link, fixed audit link, and receipts survived a page reload; proof is `evals/verification/existing-pr-receipt.json` and its PNG. The historical score-63 after-audit is absent from Supabase; only its summary was retained. Both the new local fix and existing published code now have full saved journeys/findings for diagnosis. The store was restored to clean main. No pushes were performed.

## Follow-up item 2 — fixed-store diagnosis and corrected control

The exact published code's fresh audit had three false positives: the shopper's Cotton Crew Tee (model omitted product_added), unchecked Order Protection, and an unchecked ChalakPlus trial (model treated offers as ordered items). There were no demonstrated missed store fixes. The historical score-63 run did not retain findings, so its exact list is unknown; the new score-55 run is fully retained and not presented as that historical run. Details and exact evidence: `evals/verification/FIX_DIAGNOSIS.md`.

Corrected extraction records successful add-to-cart actions, separates unchecked offers from independently charged rows, and captures native/current dialogs. Detectors and JourneyResult are unchanged. Build passed; core 18/18; API 11/11. One new UI control audit of the unchanged published store, `89ba68e3-bb3d-4c56-814d-da706f5a472c`, scored 100 at ₹499 with zero findings and all 13 screenshots stored/downloaded. The original PR receipt now links to this accurate control; older audits are retained. The UI shows 100/100 after reload. No Codex prompt change or second store fix was warranted. The store is back on clean main.

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
