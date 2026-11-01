# Real UI and Supabase checks — 1 November 2026

These opt-in checks submit the actual homepage form in Chromium, poll through the Next.js proxy, query real Supabase rows and download public Storage JPEGs. The shopper, judge, queue and database are not stubbed. Screenshot PNGs show the actual report after a reload.

## Original store (B)

- Target: `http://localhost:5050/chalak-mart.html`.
- Audit: `3489e4f9-5f98-41a3-8c39-978e58a8d883`, two visits, both reached payment.
- Price: ₹499 → ₹606. Findings: drip pricing ×2, basket sneaking ×2, subscription trap ×1, false urgency ×2, nagging ×1, confirm shaming ×1.
- All 39 step rows and 39 screenshots were stored. Every public JPEG was downloaded and checked; 1,136,939 bytes total.
- The viewer loaded both visits after a reload. Selecting the first step selected its stored screenshot. No browser errors or direct browser calls to port 4000.
- Proof: [JSON](ui-2026-11-01T08-30-39-980Z.json), [evidence viewer](evidence-2026-11-01T08-30-39-980Z.png).

## Failed baseline retained

`23c3f131-e57f-46ed-bf68-587c3449011f` failed before FIX on a PostgreSQL Unicode error. Its record remains here; it is not counted as a pass. Model JSON parsing now replaces NUL and invalid surrogate characters, with a regression test preserving valid Unicode and literal escape text.

## Local Codex Fix (C)

- The actual homepage form created `383af613-ba90-42bb-aa46-6af932802a78`; its report button triggered real Codex.
- Local branch `jhol-fix-383af613-mvxl26je`, commit `e4f6cd2`. No push or new PR.
- Supabase stores `fix_status=done` and `fixed_audit_id=0d1a31a8-5b8f-432c-973d-039a31544a1e`. Score 3 → 55, price ₹606 → ₹499, payment reached.
- All 17 baseline and 13 re-audit screenshots downloaded. Reloaded receipts show both scores/prices and the checked stamp. The sibling repo was restored to clean main.
- A long clock gap caused lost Redis leases and the original UI wait to time out. The linked re-audit persisted. GET now recovers a fix left `rechecking` from the durable improved result. The resumed check reloads the same audit; it does not claim a second form submission or a second Codex invocation.
- Proof: [original UI submission and timeout](ui-2026-11-01T08-42-31-734Z.json), [resumed persisted check](ui-2026-11-01T09-37-20-716Z.json), [receipts](receipts-2026-11-01T09-37-20-716Z.png).

## Existing PR link and receipt recovery

PR #1 was verified read-only at commit `e55f4a9b08197b44b3556bb950ac7297f30ed567`. The exact published code was audited through the UI as `b8eab4e7-a75b-4ab2-9b42-540744e25dfe`, reaching payment at ₹499, score 55; all 11 screenshots passed. Its full journey and findings are retained.

The original before-audit `a69ba9ac-5a83-49a0-8b8e-4db4ba5c9306` had no persistent fix metadata because the earlier check used memory. Its existing PR metadata was recovered and linked to the fresh persisted re-audit. This is an explicit metadata repair, not a claim that the worker created a new PR this session. The PR link, fixed-audit link and before/after receipts were verified after reload. Proof: [recovery and complete re-audit](existing-pr-receipt.json), [UI receipt](existing-pr-receipt.png). The sibling repository was restored to clean main. Nothing was pushed.

## Reproduce

Start both test stores and `pnpm dev`, with migrations 0003/0004 applied and `FIX_PUBLISH_PR=false`:

```bash
node --env-file-if-exists=apps/api/.env apps/api/test/live-ui.cjs
UI_TARGET_URL=http://localhost:5051/index.html UI_TWICE=false UI_TRIGGER_FIX=true \
  node --env-file-if-exists=apps/api/.env apps/api/test/live-ui.cjs
```

The second command invokes real Codex and creates a local commit and re-audit. It intentionally requires publishing to remain disabled. The live check uses no application secrets in its output.
