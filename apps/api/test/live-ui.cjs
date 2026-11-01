// Opt-in real UI/Supabase check. No agent, judge, database or HTTP stubs.
// From repo root: node --env-file-if-exists=apps/api/.env apps/api/test/live-ui.cjs
// UI_TARGET_URL and UI_TRIGGER_FIX select a single check; publishing must stay disabled.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { setTimeout: sleep } = require("node:timers/promises");
const { chromium } = require("../../../packages/core/node_modules/playwright");
const { createClient } = require("@supabase/supabase-js");
const redact = (text) => Object.entries(process.env).reduce((value, [name, secret]) =>
  /KEY|TOKEN|SECRET|PASSWORD/.test(name) && secret && secret.length >= 8 ? value.split(secret).join("[redacted]") : value, String(text));

const target = process.env.UI_TARGET_URL || "http://localhost:5050/chalak-mart.html";
const triggerFix = process.env.UI_TRIGGER_FIX === "true";
const resume = process.env.UI_AUDIT_ID;
const twice = process.env.UI_TWICE !== "false";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = path.resolve("evals/verification");
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function must(result, operation) {
  if (result.error) throw new Error(`${operation}: ${result.error.code || "failed"}`);
  return result.data;
}

async function main() {
  if (triggerFix) assert.notEqual(process.env.FIX_PUBLISH_PR, "true", "This verification must never publish");
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch("http://localhost:4000/health")).ok && (await fetch("http://localhost:3000")).ok) { ready = true; break; } } catch {}
    await sleep(500);
  }
  assert.ok(ready, "pnpm dev must be running on ports 3000 and 4000");
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  page.setDefaultTimeout(30_000);
  const browserErrors = [], directApiCalls = [];
  page.on("pageerror", (e) => browserErrors.push(redact(e.message)));
  page.on("request", (request) => { if (new URL(request.url()).port === "4000") directApiCalls.push(request.url()); });
  const report = { target, twice, triggerFix, createdThroughUI: !resume, resumedAudit: resume || null, stubbed: false, publishing: false };

  async function view(id) {
    return page.evaluate(async (auditId) => {
      const res = await fetch(`/api/audits/${auditId}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Report HTTP ${res.status}`);
      return res.json();
    }, id);
  }
  async function wait(id, field, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let previous;
    while (Date.now() < deadline) {
      const current = await view(id);
      const state = current.audit[field];
      if (state !== previous) { console.log(`${id} ${field}: ${state}`); previous = state; }
      if (state === "failed") throw new Error(current.audit.fix_error || current.audit.error || "Audit failed");
      if (state === "done") return current;
      await sleep(3000);
    }
    throw new Error(`Timed out waiting for ${field}`);
  }
  async function evidence(current) {
    const ids = current.runs.map((run) => run.id);
    const rows = must(await db.from("run_steps").select("run_id,idx,screenshot_path").in("run_id", ids), "run_steps");
    const apiSteps = current.runs.flatMap((run) => run.steps);
    assert.ok(rows.length > 0);
    assert.equal(rows.length, apiSteps.length);
    assert.ok(rows.every((row) => row.screenshot_path), "Every checked step should have a saved screenshot");
    const downloaded = await Promise.all(apiSteps.map(async (step) => {
      const res = await fetch(step.screenshot_url, { signal: AbortSignal.timeout(30_000) });
      assert.equal(res.status, 200);
      const bytes = new Uint8Array(await res.arrayBuffer());
      assert.equal(bytes[0], 0xff);
      assert.equal(bytes[1], 0xd8);
      return bytes.length;
    }));
    return { rows: rows.length, screenshots: downloaded.length, jpegBytes: downloaded.reduce((n, size) => n + size, 0) };
  }
  async function saveState() {
    fs.writeFileSync(path.join(out, `ui-${stamp}.json`), JSON.stringify(report, null, 2) + "\n");
    fs.writeFileSync("/tmp/jhol-latest-ui.json", JSON.stringify(report));
  }

  try {
    await page.goto(resume ? `http://localhost:3000/audits/${resume}` : "http://localhost:3000", { waitUntil: "domcontentloaded", timeout: 60_000 });
    if (!resume) {
      await page.getByLabel("Website to audit").fill(target);
      if (!twice) await page.getByRole("checkbox", { name: /Fake-timer test/ }).uncheck();
      await Promise.all([
        page.waitForURL(/\/audits\/[a-f0-9-]{36}$/, { timeout: 60_000 }),
        page.getByRole("button", { name: "Run audit", exact: true }).click(),
      ]);
    }
    const id = page.url().split("/").at(-1);
    report.auditId = id;
    console.log(`Created through UI: ${id} (${target})`);
    await saveState();
    const before = await wait(id, "status", 420_000);
    report.before = before;
    report.beforeEvidence = await evidence(before);
    assert.ok(before.runs.every((run) => run.reached_payment_page));
    if (target.includes(":5050/")) {
      assert.equal(before.audit.price_shown, 499);
      assert.equal(before.audit.price_final, 606);
      for (const [pattern, count] of Object.entries({ drip_pricing: 2, basket_sneaking: 2, subscription_trap: 1, nagging: 1 })) {
        assert.equal(before.findings.filter((f) => f.pattern === pattern).length, count, pattern);
      }
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    const panel = page.getByRole("region", { name: "Checkout evidence" });
    await panel.waitFor();
    await panel.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const images = [...document.querySelectorAll('section[aria-label="Checkout evidence"] img')];
      return images.length > 0 && images.every((img) => img.complete && img.naturalWidth > 0);
    });
    const first = before.runs[0];
    await page.getByRole("list", { name: `Visit ${first.session} steps` }).getByRole("button").first().click();
    assert.equal(await panel.locator("img").first().getAttribute("src"), first.steps[0].screenshot_url);
    await page.waitForFunction((url) => {
      const image = document.querySelector('section[aria-label="Checkout evidence"] img');
      return image && image.src === url && image.complete && image.naturalWidth > 0;
    }, first.steps[0].screenshot_url);
    await panel.screenshot({ path: path.join(out, `evidence-${stamp}.png`) });
    report.evidenceShownAfterReload = true;
    await saveState();

    if (triggerFix) {
      if (!before.audit.fix_status) await page.getByRole("button", { name: "Fix with Codex", exact: true }).click();
      const fixed = await wait(id, "fix_status", 1_000_000);
      report.fixed = fixed;
      const stored = must(await db.from("audits").select("fix_status,fix_pr_url,fix_branch,fixed_audit_id").eq("id", id).single(), "stored fix");
      assert.equal(stored.fix_status, "done");
      assert.ok(stored.fixed_audit_id);
      assert.equal(stored.fixed_audit_id, fixed.fix_after.id);
      assert.equal(stored.fix_pr_url, null, "No new PR without publishing");
      const after = await view(stored.fixed_audit_id);
      assert.ok(after.audit.score > before.audit.score);
      assert.ok(after.audit.price_final < before.audit.price_final);
      report.after = after;
      report.afterEvidence = await evidence(after);
      report.storedFix = stored;
      report.afterFindings = must(await db.from("findings").select("pattern,page,severity,evidence,detail,source").eq("audit_id", stored.fixed_audit_id), "after findings");
      report.afterRuns = must(await db.from("runs").select("id,session,result,num_steps").eq("audit_id", stored.fixed_audit_id), "after journeys");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByText("CHECKED BY JHOL", { exact: true }).waitFor();
      const receipts = page.getByRole("region", { name: "Codex fix" });
      assert.ok(await receipts.getByText(`${after.audit.score}/100`, { exact: true }).count());
      await receipts.screenshot({ path: path.join(out, `receipts-${stamp}.png`) });
      report.receiptsShownAfterReload = true;
      for (let i = 0; i < 30; i++) {
        const branch = spawnSync("git", ["branch", "--show-current"], { cwd: process.env.FIX_REPO_PATH, encoding: "utf8" }).stdout.trim();
        if (branch === "main") { report.restoredBranch = branch; break; }
        await sleep(200);
      }
      assert.equal(report.restoredBranch, "main");
    }
    assert.deepEqual(directApiCalls, [], "The browser must use the Next.js proxy");
    assert.deepEqual(browserErrors, []);
    report.browserErrors = browserErrors;
    await saveState();
    console.log(JSON.stringify({ auditId: id, evidence: report.beforeEvidence, fixedAuditId: report.storedFix?.fixed_audit_id,
      beforeScore: before.audit.score, afterScore: report.after?.audit.score, beforePrice: before.audit.price_final, afterPrice: report.after?.audit.price_final,
      restoredBranch: report.restoredBranch, saved: `evals/verification/ui-${stamp}.json` }, null, 2));
  } catch (e) {
    report.error = redact(e.message);
    await saveState();
    throw e;
  } finally { await browser.close(); }
}
main().catch((e) => { console.error(redact(e.message)); process.exitCode = 1; });
