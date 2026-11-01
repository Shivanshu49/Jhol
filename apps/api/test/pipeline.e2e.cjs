// End-to-end check of the audit pipeline: real Nest app + real BullMQ/Redis,
// a stub browser agent (RUN_JOURNEY provider) and an in-memory database (no Supabase, no OpenAI).
//
//   docker compose up -d                      # Redis on :6379
//   pnpm --filter @jhol/api build && pnpm --filter @jhol/api test:e2e
//
// Uses Redis DB 15 so it never touches your dev queue.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/15";
process.env.JHOL_API_KEY = "test-key";
process.env.SUPABASE_URL = "http://not-used.local";
process.env.SUPABASE_SERVICE_ROLE_KEY = "not-used";
process.env.OPENAI_API_KEY = ""; // judge off: rule findings only (beats apps/api/.env, which Nest also loads)
process.env.EXA_API_KEY = ""; // no precedents: the audit must still finish
process.env.ALLOW_PRIVATE_TARGETS = ""; // production default: private targets refused
process.env.SESSION_B_DELAY_MS = "1500";
process.env.FIX_REPO_PATH = "/tmp/jhol-test-store";
process.env.FIX_STORE_URL = "http://localhost:5051/index.html";

const { Test } = require("@nestjs/testing");
const { getQueueToken } = require("@nestjs/bullmq");
const { AppModule } = require("../dist/app.module");
const { DbService } = require("../dist/common/db.service");
const { RUN_JOURNEY } = require("../dist/audits/audits.processor");
const { FixService } = require("../dist/audits/fix.service");

// ---------------------------------------------------------------- in-memory DB (same methods as DbService)

const { MemoryDb } = require("./memory-db.cjs");

// ---------------------------------------------------------------- stub browser agent

function chalakJourney(session) {
  const urgency = session === "A" ? ["Deal ends in 04:52", "Only 3 left in stock!"] : ["Deal ends in 04:55", "Only 5 left in stock!"];
  return {
    reached_payment_page: true,
    stop_reason: "Reached payment step",
    items_added_by_agent: ["Cotton Crew Tee"],
    steps: [
      { page: "home", total_shown: null, line_items: [], preselected: [], urgency_texts: [], choice_texts: [], popups: ["Get 10% off your first order! Join the Chalak Club for secret deals in your inbox."] },
      { page: "product", total_shown: 499, line_items: [{ label: "Cotton Crew Tee", amount: 499 }], preselected: [], urgency_texts: urgency, choice_texts: [], popups: ["Get 10% off your first order! Join the Chalak Club"] },
      { page: "cart", total_shown: 558, line_items: [{ label: "Cotton Crew Tee × 1", amount: 499 }, { label: "Donation to Green India Fund", amount: 10 }], preselected: [{ label: "Order Protection", amount: 49 }, { label: "ChalakPlus 7-day free trial", amount: 0 }], urgency_texts: [], choice_texts: ["Yes, protect my order", "No thanks, I don't mind if my order arrives broken"], popups: ["Get 10% off your first order!"] },
      { page: "review", total_shown: 606, line_items: [{ label: "Cotton Crew Tee × 1", amount: 499 }, { label: "Platform fee", amount: 19 }, { label: "Handling fee", amount: 29 }, { label: "Total payable", amount: 606 }], preselected: [], urgency_texts: [], choice_texts: [], popups: ["Get 10% off your first order! Join the Chalak Club"] },
      { page: "payment", total_shown: 606, line_items: [], preselected: [], urgency_texts: [], choice_texts: [], popups: [] },
    ],
  };
}

const agentCalls = [];
async function stubRunJourney(url, opts) {
  agentCalls.push({ url, opts });
  if (url.includes("broken")) throw new Error("page.goto: net::ERR_NAME_NOT_RESOLVED");
  const session = agentCalls.filter((c) => !c.url.includes("broken")).length === 1 ? "A" : "B";
  const hint = (total_shown) => ({ total_shown, line_items: [], urgency_texts: [], choice_texts: [], popups: [] });
  const llm = { provider: "openai", model: "stub", latencyMs: 1 };
  await opts.onStep({ index: 1, url, page: "product", action: { type: "click", target: "e4", value: null, reason: "add the cheapest product" }, targetText: "Add to cart", screenshot: Buffer.from("jpeg-1"), newFindingsHint: hint(499), error: null, llm });
  await opts.onStep({ index: 2, url, page: "payment", action: { type: "stop", target: null, value: null, reason: "payment options visible" }, targetText: null, screenshot: Buffer.from("jpeg-2"), newFindingsHint: hint(606), error: null, llm });
  return { ...chalakJourney(session), stepsTaken: 18 };
}

// ---------------------------------------------------------------- app

let app;
let baseUrl;
const db = new MemoryDb();
let fixCalls = 0;
const api = (path, init = {}) =>
  fetch(`${baseUrl}${path}`, { ...init, headers: { "content-type": "application/json", "x-api-key": "test-key", ...(init.headers ?? {}) } });

before(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRole("all")] })
    .overrideProvider(DbService)
    .useValue(db)
    .overrideProvider(RUN_JOURNEY)
    .useValue(stubRunJourney)
    .overrideProvider(FixService)
    .useValue({ run: async (id) => { fixCalls++; await db.updateFix(id, { fix_status: "done" }); return "done"; } })
    .compile();
  app = moduleRef.createNestApplication({ logger: ["error"] });
  await app.listen(0, "127.0.0.1");
  baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  await app.get(getQueueToken("audits")).obliterate({ force: true });
});

after(async () => {
  await app?.close();
});

test("rejects calls without the shared API key", async () => {
  const res = await fetch(`${baseUrl}/audits`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(res.status, 401);
});

test("rejects private URLs", async () => {
  for (const url of ["http://localhost:3000/lab/chalak-mart.html", "http://127.0.0.1:5050/", "http://[::1]/", "http://169.254.169.254/latest/meta-data/"]) {
    const res = await api("/audits", { method: "POST", body: JSON.stringify({ url }) });
    assert.equal(res.status, 400, url);
  }
});

test("runs a two-visit audit end to end", async () => {
  const created = await api("/audits", { method: "POST", body: JSON.stringify({ url: "https://1.1.1.1/lab/chalak-mart.html", sessions: 2, pincode: "560001" }) });
  assert.equal(created.status, 201);
  const { id } = await created.json();

  let view;
  for (let i = 0; i < 100; i++) {
    view = await (await api(`/audits/${id}`)).json();
    if (view.audit.status === "done" || view.audit.status === "failed") break;
    await new Promise((r) => setTimeout(r, 200));
  }

  assert.equal(view.audit.status, "done", view.audit.error ?? "audit did not finish");
  assert.equal(view.audit.price_shown, 499);
  assert.equal(view.audit.price_final, 606);
  assert.match(view.audit.report_hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(view.runs.map((r) => [r.session, r.status]), [["A", "COMPLETED"], ["B", "COMPLETED"]]);
  assert.deepEqual(view.runs.map((r) => r.num_steps), [18, 18]);
  assert.equal(view.runs[0].pages.join(">"), "home>product>cart>review>payment");

  const count = (p) => view.findings.filter((f) => f.pattern === p).length;
  assert.equal(count("drip_pricing"), 2);
  assert.equal(count("basket_sneaking"), 2);
  assert.equal(count("subscription_trap"), 1);
  assert.equal(count("nagging"), 1);
  assert.equal(count("false_urgency"), 2);
  assert.equal(view.findings[0].severity, "high", "findings sorted by severity");
  assert.deepEqual(view.precedents, {}, "no EXA_API_KEY: audit finishes without precedents");
  assert.equal(view.audit.precedents, undefined, "precedents returned once, at the top level");

  // live step log, per run, with public screenshot URLs
  for (const r of view.runs) {
    assert.deepEqual(r.steps.map((st) => [st.idx, st.page, st.action, st.total_shown]), [[1, "product", 'click "Add to cart"', 499], [2, "payment", "stop", 606]]);
    assert.equal(r.steps[0].reason, "add the cheapest product");
    assert.equal(r.steps[0].screenshot_url, `https://storage.example/screens/${id}/${r.session}/1.jpg`);
  }
  assert.equal(db.screens.get(`${id}/A/2.jpg`)?.toString(), "jpeg-2");

  // what we actually asked the agent to do
  assert.equal(agentCalls.length, 2, "exactly two agent runs (A and B)");
  assert.equal(agentCalls[0].url, "https://1.1.1.1/lab/chalak-mart.html");
  assert.equal(agentCalls[0].opts.pincode, "560001");
  assert.equal(agentCalls[0].opts.allowPrivateNetwork, false, "browser guard on unless ALLOW_PRIVATE_TARGETS");
});

test("an agent error fails the run and the audit, with the reason", async () => {
  const created = await api("/audits", { method: "POST", body: JSON.stringify({ url: "https://1.1.1.1/broken", sessions: 1 }) });
  const { id } = await created.json();
  let view;
  for (let i = 0; i < 50; i++) {
    view = await (await api(`/audits/${id}`)).json();
    if (view.audit.status === "done" || view.audit.status === "failed") break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal(view.audit.status, "failed");
  assert.match(view.audit.error, /ERR_NAME_NOT_RESOLVED/);
  assert.deepEqual(view.runs.map((r) => [r.session, r.status]), [["A", "FAILED"]]);
});

test("a saved re-audit recovers a fix left rechecking after its worker lost its lease", async () => {
  const before = await db.createAudit({ url: process.env.FIX_STORE_URL, sessions: 1, options: {} });
  const after = await db.createAudit({ url: process.env.FIX_STORE_URL, sessions: 1, options: {} });
  await db.finishAudit(before.id, { status: "done", price_final: 606, score: 3 });
  await db.updateFix(before.id, { fix_status: "rechecking", fixed_audit_id: after.id });
  let view = await (await api(`/audits/${before.id}`)).json();
  assert.equal(view.audit.fix_status, "rechecking", "unfinished audit cannot mark the fix done");
  await db.finishAudit(after.id, { status: "done", price_final: 499, score: 55 });
  view = await (await api(`/audits/${before.id}`)).json();
  assert.equal(view.audit.fix_status, "done");
  assert.equal((await db.getAudit(before.id)).fix_status, "done", "recovery must persist");
  assert.equal(view.fix_after.id, after.id);
  const worse = await db.createAudit({ url: process.env.FIX_STORE_URL, sessions: 1, options: {} });
  await db.finishAudit(worse.id, { status: "done", price_final: 606, score: 3 });
  await db.updateFix(worse.id, { fix_status: "rechecking", fixed_audit_id: before.id });
  view = await (await api(`/audits/${worse.id}`)).json();
  assert.equal(view.audit.fix_status, "failed", "an unchanged result must never be stamped checked");
});

test("fix endpoint restricts the target, requires a finished audit, and queues exactly once", async () => {
  const wrong = await db.createAudit({ url: "https://1.1.1.1/", sessions: 1, options: {} });
  await db.finishAudit(wrong.id, { status: "done" });
  assert.equal((await api(`/audits/${wrong.id}/fix`, { method: "POST" })).status, 400);
  const audit = await db.createAudit({ url: process.env.FIX_STORE_URL, sessions: 1, options: {} });
  assert.equal((await api(`/audits/${audit.id}/fix`, { method: "POST" })).status, 409);
  await db.finishAudit(audit.id, { status: "done", price_final: 606, score: 0 });
  assert.equal((await api(`/audits/${audit.id}/fix`, { method: "POST" })).status, 400);
  await db.insertFindings(audit.id, [{ pattern: "basket_sneaking", severity: "high", page: "cart", evidence: "Donation", detail: "Auto-added", source: "rule" }]);
  const unauthorized = await fetch(`${baseUrl}/audits/${audit.id}/fix`, { method: "POST" });
  assert.equal(unauthorized.status, 401);
  assert.equal((await api(`/audits/${audit.id}/fix`, { method: "POST" })).status, 201);
  assert.equal((await api(`/audits/${audit.id}/fix`, { method: "POST" })).status, 201);
  for (let i = 0; i < 20 && fixCalls === 0; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(fixCalls, 1);
  const view = await (await api(`/audits/${audit.id}`)).json();
  assert.equal(view.fix_available, true);
  assert.equal(view.audit.fix_status, "done");
});
