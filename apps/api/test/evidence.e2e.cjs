const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DbService } = require("../dist/common/db.service");
const { AuditsProcessor } = require("../dist/audits/audits.processor");

test("a missing steps migration keeps reports readable; other database errors still surface", async () => {
  const db = new DbService({ getOrThrow: (key) => key === "SUPABASE_URL" ? "http://localhost" : "test-key" });
  let code = "PGRST205";
  const query = { select() { return this; }, in() { return this; }, async order() { return { data: null, error: { code, message: "missing relation" } }; } };
  db.sb = { from: () => query };
  assert.deepEqual(await db.getSteps(["run"]), []);
  code = "08006";
  await assert.rejects(db.getSteps(["run"]), /get steps: missing relation/);
});

test("failed screenshot uploads still save the step and its action error", async () => {
  const saved = [];
  const db = { uploadScreenshot: async () => { throw new Error("storage unavailable"); }, upsertStep: async (step) => saved.push(step) };
  const worker = new AuditsProcessor(db, {}, async () => {}, {});
  await worker.saveStep("audit", "A", "run", {
    index: 1, page: "cart", screenshot: Buffer.from("jpeg"), targetText: "Checkout",
    action: { type: "click", target: "e1", value: null, reason: "Continue" },
    error: "Covered by popup", newFindingsHint: { total_shown: 558 },
  });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].screenshot_path, null);
  assert.match(saved[0].reason, /Action failed: Covered by popup/);
});

test("a retried completed session still schedules finalization", async () => {
  const queued = [];
  const db = { getAudit: async () => ({ status: "running" }), getRuns: async () => [{ session: "A", status: "COMPLETED" }] };
  const worker = new AuditsProcessor(db, {}, async () => { throw new Error("must not run twice"); }, { add: async (...args) => queued.push(args) });
  await worker.process({ name: "start-session", data: { auditId: "audit", session: "A" } });
  assert.equal(queued.length, 1);
  assert.equal(queued[0][0], "finalize");
});
