// Opt-in live proof. Real agent, OpenAI judge, Codex CLI, git, GitHub and Redis DB 14;
// in-memory DB only, so this can validate the demo while Supabase migrations await the SQL editor.
// From repo root: node --env-file-if-exists=apps/api/.env apps/api/test/live-fix.cjs
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { setTimeout: sleep } = require("node:timers/promises");
const redis = new URL(process.env.REDIS_URL || "redis://localhost:6379");
redis.pathname = "/14";
process.env.REDIS_URL = redis.toString();
const { Test } = require("@nestjs/testing");
const { AppModule } = require("../dist/app.module");
const { DbService } = require("../dist/common/db.service");
const { runCommand } = require("../dist/common/command");
const { MemoryDb } = require("./memory-db.cjs");

async function main() {
  const db = new MemoryDb();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRole("all")] })
    .overrideProvider(DbService).useValue(db).compile();
  const app = moduleRef.createNestApplication({ logger: ["error"] });
  await app.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  async function request(route, body) {
    const res = await fetch(`${base}${route}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", "x-api-key": process.env.JHOL_API_KEY }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(`${route}: ${res.status} ${data.message || ""}`);
    return data;
  }
  async function waitFor(id, field, deadlineMs) {
    const deadline = Date.now() + deadlineMs;
    let previous;
    while (Date.now() < deadline) {
      const view = await request(`/audits/${id}`);
      const state = view.audit[field];
      if (state !== previous) { console.log(`${field}: ${state}`); previous = state; }
      if (state === "failed") throw new Error(view.audit.fix_error || view.audit.error || "Audit failed");
      if (state === "done") return view;
      await sleep(2000);
    }
    throw new Error(`Timed out waiting for ${field}`);
  }
  try {
    console.log("LIVE FIX: in-memory database, real agent/Codex/Redis/git/GitHub");
    let id = process.env.JHOL_BASELINE_AUDIT_ID;
    if (id) {
      const cloud = new DbService({ getOrThrow: (key) => process.env[key] });
      const baseline = await cloud.getAudit(id);
      assert.equal(baseline?.url, process.env.FIX_STORE_URL);
      assert.equal(baseline?.status, "done");
      db.audits.set(id, { ...baseline, fix_status: null });
      for (const run of await cloud.getRuns(id)) db.runs.set(run.id, run);
      db.findings.push(...await cloud.getFindings(id));
      console.log("Reused the completed Supabase baseline; fix state and re-audit use the in-memory DB.");
    } else {
      ({ id } = await request("/audits", { url: process.env.FIX_STORE_URL, sessions: 1 }));
    }
    const before = await waitFor(id, "status", 300_000);
    assert.equal(before.audit.price_final, 606);
    await request(`/audits/${id}/fix`, {});
    const after = await waitFor(id, "fix_status", 950_000);
    assert.equal(after.fix_after.status, "done");
    assert.ok(after.fix_after.score > before.audit.score);
    assert.ok(after.fix_after.price_final < before.audit.price_final);
    // The FIX job's finally block restores main immediately after writing its terminal state.
    for (let i = 0; i < 20; i++) {
      if ((await runCommand("git", ["branch", "--show-current"], process.env.FIX_REPO_PATH)) === "main") break;
      await sleep(100);
    }
    assert.equal(await runCommand("git", ["branch", "--show-current"], process.env.FIX_REPO_PATH), "main");
    const summary = { mode: "in-memory database; real agent/Codex/Redis/git/GitHub", auditId: id,
      before: { score: before.audit.score, price_final: before.audit.price_final }, after: after.fix_after,
      branch: after.audit.fix_branch, pr: after.audit.fix_pr_url || null, diff: after.audit.fix_diff_summary, restoredBranch: "main" };
    console.log(JSON.stringify(summary, null, 2));
    const out = path.resolve("evals/fix-check-2026-11-01.json");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(summary, null, 2) + "\n");
    fs.writeFileSync("/tmp/jhol-fix-view.json", JSON.stringify(after));
  } finally { await app.close(); }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
