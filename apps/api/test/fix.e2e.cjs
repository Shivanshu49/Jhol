const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { FixService } = require("../dist/audits/fix.service");
const { runCommand } = require("../dist/common/command");
const { MemoryDb } = require("./memory-db.cjs");

test("Codex Fix commits an isolated branch, re-audits, saves receipts and restores main without GitHub", async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "jhol-fix-test-"));
  const git = (...args) => runCommand("git", args, repo);
  try {
    await git("init", "-b", "main");
    await git("config", "user.email", "test@example.com");
    await git("config", "user.name", "Jhol Test");
    await fs.writeFile(path.join(repo, "index.html"), "<h1>Tee ₹499</h1><p>Hidden donation ₹10</p>");
    await git("add", "--", "index.html");
    await git("commit", "-m", "Fixture");
    const db = new MemoryDb();
    const before = await db.createAudit({ url: "http://localhost:5051/index.html", sessions: 1, options: {} });
    await db.finishAudit(before.id, { status: "done", fix_status: "queued", score: 25, price_final: 606 });
    await db.insertFindings(before.id, [{ pattern: "basket_sneaking", page: "cart", evidence: "Hidden donation ₹10" }]);
    const states = [];
    const update = db.updateFix.bind(db);
    db.updateFix = async (id, patch) => { if (patch.fix_status) states.push(patch.fix_status); await update(id, patch); };
    const audits = { create: async (input) => {
      assert.equal(input.sessions, 1);
      assert.equal(await git("branch", "--show-current"), (await db.getAudit(before.id)).fix_branch);
      const after = await db.createAudit(input);
      await db.finishAudit(after.id, { status: "done", score: 100, price_final: 499 });
      return after;
    } };
    const config = { getOrThrow: (key) => key === "FIX_REPO_PATH" ? repo : before.url };
    const codex = async (cwd, prompt) => {
      assert.match(prompt, /Hidden donation/);
      await fs.writeFile(path.join(cwd, "index.html"), "<h1>Tee ₹499</h1>");
      return "Removed the unwanted donation.";
    };
    const service = new FixService(db, audits, config, codex);
    assert.equal(await service.run(before.id), "fixed and rechecked");
    const result = await db.getAudit(before.id);
    assert.equal(result.fix_status, "done");
    assert.match(result.fix_branch, /^jhol-fix-/);
    assert.match(result.fix_diff_summary, /index.html/);
    assert.equal(result.fix_message, "Removed the unwanted donation.");
    assert.equal((await db.getAudit(result.fixed_audit_id)).score, 100);
    assert.equal(await git("branch", "--show-current"), "main");
    assert.match(await git("show", `${result.fix_branch}:index.html`), /Tee ₹499/);
    assert.doesNotMatch(await git("show", `${result.fix_branch}:index.html`), /donation/);
    assert.match(await fs.readFile(path.join(repo, "index.html"), "utf8"), /donation/);
    assert.deepEqual(states, ["fixing", "rechecking", "done"]);
    await assert.rejects(fs.access(path.join(repo, ".git", "jhol-fix.lock")));
  } finally { await fs.rm(repo, { recursive: true, force: true }); }
});

test("command runner enforces its timeout and does not forward application secrets", async () => {
  const cwd = os.tmpdir();
  await assert.rejects(runCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], cwd, undefined, 100), /timed out/);
  const previous = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-secret-kept-out-of-subprocesses";
  try {
    const value = await runCommand(process.execPath, ["-e", "process.stdout.write(process.env.SUPABASE_SERVICE_ROLE_KEY ? 'leaked' : 'absent')"], cwd);
    assert.equal(value, "absent");
  } finally {
    if (previous === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previous;
  }
});
