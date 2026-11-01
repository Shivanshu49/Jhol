# Jhol × DevDay — build plan + Codex prompts

Repo today: `main` = original scaffold (TinyFish-based). Everything below happens on a new branch `devday`.
Run every step in order. **Don't start the next step until the current step's "Check" passes.**

Demo runs **on your laptop** (Playwright + local Chalak Mart + OpenAI API). Deploying is optional at the end.

---

## Step 0 — Setup (15 min, by hand)

```bash
git clone https://github.com/Shivanshu49/Jhol && cd Jhol
git checkout -b devday
# apply the landing-page redesign: unzip jhol-landing.zip in the repo root (overwrite), then:
corepack enable && pnpm install
pnpm --filter @jhol/core add playwright openai
pnpm --filter @jhol/core exec playwright install chromium
docker compose up -d          # Redis (or put a Railway Redis URL in REDIS_URL)
git add -A && git commit -m "Landing page redesign + agent deps"
```

Add to `apps/api/.env` (copy from `.env.example` first):
```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=<a fast model from your OpenAI dashboard>
# optional, to run the same agent on Cerebras (OpenAI-compatible):
# OPENAI_BASE_URL=https://api.cerebras.ai/v1
# OPENAI_API_KEY=<cerebras key>   OPENAI_MODEL=gpt-oss-120b
```

Serve the test store locally (keep this terminal open all day):
```bash
npx serve apps/web/public/lab -l 5050
# → http://localhost:5050/chalak-mart.html
```

Create `AGENTS.md` in the repo root with the content at the bottom of this file, commit it. Codex reads it on every task.

---

## Step 1 — Build the agent (the most important step)

**Codex prompt:**

```
Read AGENTS.md first. Replace TinyFish with our own browser agent in packages/core. Keep the public output shape exactly the same so the detectors don't change.

1. Create packages/core/src/journey.ts and MOVE these out of tinyfish.ts unchanged: types LineItem, JourneyStep, JourneyResult, the function checkoutGoal(), toLineItem(), toJourney(), and SESSION_B_DELAY_MS. Then delete packages/core/src/tinyfish.ts and update src/index.ts exports. Nothing may import tinyfish anymore.

2. Create packages/core/src/snapshot.ts: export async function takeSnapshot(page: Page): Promise<Snapshot>.
   Run one page.evaluate that:
   - finds VISIBLE elements only (non-zero size, not display:none/visibility:hidden):
     buttons, links, [role=button], inputs, selects, textareas, checkboxes and radios;
   - tags each with attribute data-jhol-id="e1", "e2", ... (re-tag on every snapshot);
   - returns for each: id, tag, type, text (innerText/value/aria-label/placeholder, trimmed, max 80 chars), checked (for checkbox/radio), and the text of its <label> if any;
   - also returns, max 40 each, short visible text lines (max 120 chars) that contain a price (₹, Rs, INR or a number with .00), a timer pattern (\d{1,2}:\d{2}), "left in stock"/"only N left"/"viewing", and the full text of any open dialog/modal ([role=dialog], [aria-modal=true], or position:fixed elements with z-index>=100 covering the centre);
   - returns url, title, and a list of CHECKED checkboxes/radios with their label text (this is captured by code, not the model).
   Keep the serialized snapshot under ~10,000 characters: drop the longest/least useful items first.
   Also export snapshotToText(s) that renders it compactly, one line per element, e.g.
   [e7] checkbox CHECKED "Order Protection (₹49): covers loss in transit"

3. Create packages/core/src/agent.ts: export async function runJourney(url: string, opts: { pincode?: string; maxSteps?: number; onStep?: (step: AgentStepEvent) => void | Promise<void>; headless?: boolean }): Promise<JourneyResult & { stepsTaken: number }>.
   - Launch Playwright chromium (headless by default), viewport 1280x800, go to url, wait for load.
   - Loop up to maxSteps (default 25):
     a. snapshot = takeSnapshot(page)
     b. call the OpenAI API (openai npm package, Chat Completions, model = process.env.OPENAI_MODEL, baseURL = process.env.OPENAI_BASE_URL if set) with:
        - system: checkoutGoal(pincode) + the RULES below
        - user: current URL, snapshotToText(snapshot), the list of actions taken so far (last 8) and the error of the last action if it failed
        - response_format json_schema (strict) with this shape:
          { page: string,
            page_data: { total_shown: number|null, line_items: [{label, amount: number|null}], urgency_texts: string[], choice_texts: string[], popups: string[] },
            product_added: string|null,
            action: { type: "click"|"fill"|"select"|"stop", target: string|null, value: string|null, reason: string } }
     c. Record the page: if `page` is new, push a JourneyStep; if it's the same page as the last step, merge (union the arrays, keep the latest total). IMPORTANT: preselected for a step = the CHECKED list from the FIRST snapshot of that page, taken by code before the agent clicks anything there (never from the model).
     d. Execute the action on [data-jhol-id=target]: click → click; fill → fill(value); select → selectOption(value). Then wait for load state 'domcontentloaded' and 700 ms. On any Playwright error, don't crash: remember the error and continue the loop.
     e. Take a JPEG screenshot (quality 60) and call onStep({ index, url, page, action, screenshot: Buffer, newFindingsHint: page_data }).
     f. Stop when action.type === "stop", or when the snapshot shows payment fields (input names/labels matching card|cvv|upi|otp|expiry) or payment method buttons (UPI, Card, Net banking, Cash on delivery) — set reached_payment_page = true in that case and record that page first.
   - Loop guard: if the same URL + same snapshot text repeats 3 times in a row, add "You are stuck; try a different element or stop" to the next prompt; if it repeats 5 times, stop with stop_reason "stuck".
   - Always close the browser in finally.
   - Return { reached_payment_page, stop_reason, items_added_by_agent (from product_added values), steps, stepsTaken }, passed through toJourney() so the shape is validated.

   RULES for the system prompt (add to checkoutGoal's text):
   - Choose element ids only from the snapshot. Never invent ids.
   - Add exactly one unit of the cheapest product.
   - When a popup or upsell appears: first copy BOTH the accept and the decline wording into choice_texts, then choose the decline/close option.
   - Never untick or remove anything the site pre-selected.
   - Never type into card, CVV, UPI, OTP or password fields. Use Test User / test@example.com / the pincode for guest forms.
   - Stop as soon as payment options are visible.
   - Amounts are plain numbers in rupees (no ₹, no commas).

4. Create packages/core/src/cli.ts and a package script "agent": "node dist/cli.js".
   Usage: pnpm --filter @jhol/core agent <url> [--headed] [--twice].
   It runs runJourney, saves screenshots to ./runs/<timestamp>/step-XX.jpg, prints one line per step, then prints runRuleDetectors() output and priceDrift. With --twice it waits SESSION_B_DELAY_MS (env override allowed), runs a second session, and passes both to runRuleDetectors so false urgency is tested.

5. Keep `pnpm --filter @jhol/core build` and `test` passing. Do not change detectors.ts.
```

**Check (must pass before Step 2):**
```bash
pnpm --filter @jhol/core build
pnpm --filter @jhol/core agent http://localhost:5050/chalak-mart.html --headed
```
You should see the browser shop and the output must show:
- `reached_payment_page: true`
- price drift **499 → 606**
- findings include drip_pricing ×2 (platform + handling fee), basket_sneaking ×2 (donation + order protection), subscription_trap ×1, nagging ×1

Run it **3 times**. If any run fails, use the fix prompt below; don't move on.

**Fix prompt (if the agent misbehaves):**
```
Run `pnpm --filter @jhol/core agent http://localhost:5050/chalak-mart.html` and read the step log and the screenshots in runs/. The agent <describe: e.g. loops on the popup / never reaches payment / misses the donation line>. Find the cause in snapshot.ts or agent.ts and fix it. Don't change detectors.ts or the JourneyResult shape. Re-run 3 times and show me the outputs.
```

Then with the false-urgency test:
```bash
SESSION_B_DELAY_MS=60000 pnpm --filter @jhol/core agent http://localhost:5050/chalak-mart.html --twice
```
Must also show **false_urgency** (timer restarted). Commit: `git commit -am "Own browser agent: Playwright + OpenAI"`.

---

## Step 2 — Plug the agent into the API/worker

**Codex prompt:**
```
Read AGENTS.md. The worker in apps/api still uses TinyFish (start run, poll, webhook). Replace that with runJourney() from @jhol/core.

- audits.processor.ts: the START_SESSION job now runs runJourney(audit.url, { pincode: audit.options.pincode, onStep }) directly and, when it returns, saves the result to the run row (status COMPLETED, result, num_steps = stepsTaken), then enqueues FINALIZE. On error: status FAILED with the message, then enqueue FINALIZE. Remove CHECK_RUN entirely and the TinyFish webhook controller (apps/api/src/webhooks). Keep FINALIZE as is.
- Give the BullMQ worker lockDuration 120000 so long runs don't stall.
- onStep: upload the screenshot to Supabase Storage bucket "screens" at <auditId>/<session>/<index>.jpg (create the bucket in the migration, public read is fine for the demo), and insert a row in a new table run_steps(id uuid pk, run_id fk runs, idx int, page text, action text, reason text, screenshot_path text, total_shown numeric null, created_at). Add this to a new migration supabase/migrations/0002_agent_steps.sql.
- GET /audits/:id must now also return, per run, its steps (idx, page, action, reason, total_shown, screenshot_url).
- judge.service.ts: switch from Anthropic to the OpenAI API (same openai package, OPENAI_MODEL, OPENAI_BASE_URL), keep buildJudgePrompt/parseJudge.
- Remove TINYFISH_*, ANTHROPIC_*, PUBLIC_API_URL and WEBHOOK_SECRET from .env.example; add OPENAI_API_KEY, OPENAI_MODEL, OPENAI_BASE_URL.
- Update apps/api/test/pipeline.e2e.cjs: replace the fake TinyFish server with a stub runJourney (inject via a provider token so tests can override it) that returns the Chalak Mart journey. Keep the existing assertions. All tests must pass.
```

**Check:**
```bash
# first run supabase/migrations/0002_agent_steps.sql in the Supabase SQL editor
pnpm turbo run build && pnpm --filter @jhol/api test:e2e
pnpm dev      # web :3000, api+worker :4000
```
Open localhost:3000 → paste `http://localhost:5050/chalak-mart.html` → Run audit → report shows ₹499 → ₹606 and the findings. Commit.

---

## Step 3 — Live audit screen (frontend teammate, in parallel with Step 4)

**Codex prompt:**
```
Read AGENTS.md. In apps/web, redesign /audits/[id] (audit-report.tsx) using the same visual language as the landing page (receipt style, redpen for problems, bluepen for actions, fonts already in globals.css):
- While running: two columns. Left = latest step screenshot, large. Right = step log, one line per step ("Clicked Add to cart", "Declined upsell"…) appearing as they arrive; when a step's total_shown changes, show the running price (₹499 → ₹558 → ₹606) prominently at the top.
- When done: a receipt-style summary "₹shown → ₹final (+x%)" with the score, then the finding cards with evidence text, each with the screenshot thumbnail of the page it was found on.
- Poll every 2 s while status is running/finalizing (already implemented — keep it).
- Must look good at 1280px and on mobile. Update src/lib/types.ts for the new steps field.
```

---

## Step 4 — Codex Fix (the wow moment)

Setup by hand (10 min):
```bash
# a separate repo for the demo store
mkdir ../chalak-mart && cp apps/web/public/lab/chalak-mart.html ../chalak-mart/index.html
cd ../chalak-mart && git init && git add . && git commit -m "Chalak Mart (with dark patterns)"
gh repo create chalak-mart --public --source=. --push
npx serve . -l 5051       # the "store being fixed" runs here
npm i -g @openai/codex && codex login   # if not already
```

**Codex prompt (in the Jhol repo):**
```
Read AGENTS.md. Add "Fix with Codex" for the demo store.

- New env FIX_REPO_PATH (absolute path to a local git clone of the store, e.g. ../chalak-mart) and FIX_STORE_URL (where that clone is served, e.g. http://localhost:5051/index.html).
- POST /audits/:id/fix (api, ApiKeyGuard): loads the findings, writes them to a prompt, and enqueues a FIX job.
- FIX job (worker):
  1. in FIX_REPO_PATH: git checkout -b jhol-fix-<shortid> from main;
  2. run `codex exec --full-auto "<prompt>"` with cwd FIX_REPO_PATH. The prompt lists every finding (pattern, page, evidence) and asks Codex to remove each dark pattern in index.html while keeping the store working: no auto-added donation, no pre-ticked add-ons or trials, show all fees on the product page or remove them, an honest countdown or none, neutral decline wording, a popup at most once. Store Codex's final message;
  3. git add/commit, git push -u origin, then `gh pr create --fill` and save the PR URL;
  4. create a NEW audit of FIX_STORE_URL (sessions: 1) and save its id as fixed_audit_id on the original audit (add columns fix_status, fix_pr_url, fixed_audit_id via migration 0003).
- GET /audits/:id returns fix_status, fix_pr_url and, if available, the fixed audit's score and price_final.
- Web: on the report, a "Fix with Codex" button (bluepen) → states: Fixing… → PR opened (link) → Re-checking… → side-by-side receipts "Before ₹606 · score X" vs "After ₹499 · score Y" with a "CHECKED BY JHOL" stamp. Add the web route handler that proxies POST /api/audits/[id]/fix to the API.
Use child_process.spawn with arguments arrays (no shell string concatenation). Time out codex exec after 10 minutes.
```

**Check:** Run an audit on `http://localhost:5051/index.html` → click Fix with Codex → a PR appears on GitHub → re-audit score goes up. Reset for the next demo: `git checkout main` in chalak-mart.

---

## Step 5 — Evals (30–45 min)

**Codex prompt:**
```
Read AGENTS.md. Add packages/core/src/eval.ts and a script "eval": "node dist/eval.js".
It runs runJourney on http://localhost:5050/chalak-mart.html N times (default 3, flag --runs), runs runRuleDetectors on each (pass two sessions when --twice), compares against apps/web/public/lab/ground-truth.json (map each planted pattern P1–P9 to an expected finding pattern; P6 confirm_shaming needs the LLM judge, so call the same judge prompt via OpenAI; P7 interface_interference is out of scope — mark "not supported"), and prints a table: pattern, caught in X/N runs, plus overall catch rate, average steps and average seconds per run. Also write evals/results-<date>.json.
```

**Check:** `pnpm --filter @jhol/core eval --runs 3` → use the real numbers in the pitch ("Jhol caught X of 8 supported patterns in 3/3 runs, ~Y s per audit").

---

## Step 6 — Freeze + demo prep (last 60–90 min)

- Feature freeze. Run the full demo twice: landing → audit Chalak Mart (5051) → live screen → report → Fix with Codex → PR → after receipt.
- Record a backup screen video of one full good run (OBS / QuickTime).
- README: replace TinyFish sections with "Playwright + OpenAI agent", "Codex Fix", eval numbers, how to run locally.
- Commit + push `devday`. Optional: open a PR devday → main.

**If time runs out, cut in this order:** evals → screenshot thumbnails → mobile polish. Never cut the agent or Codex Fix.

---

## AGENTS.md (create in repo root)

```markdown
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
- Secrets only via env (OPENAI_API_KEY, SUPABASE_*, JHOL_API_KEY). Never log them.
- Use child_process with argument arrays, never shell strings built from user input.
- TypeScript strict. Run before finishing: pnpm turbo run build && pnpm --filter @jhol/core test && pnpm --filter @jhol/api test:e2e

## Run locally
- npx serve apps/web/public/lab -l 5050   (test store)
- docker compose up -d                    (Redis)
- pnpm dev                                (web :3000, api+worker :4000)
- pnpm --filter @jhol/core agent http://localhost:5050/chalak-mart.html --headed
```
