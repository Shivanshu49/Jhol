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

const { Test } = require("@nestjs/testing");
const { getQueueToken } = require("@nestjs/bullmq");
const { AppModule } = require("../dist/app.module");
const { DbService } = require("../dist/common/db.service");
const { RUN_JOURNEY } = require("../dist/audits/audits.processor");

// ---------------------------------------------------------------- in-memory DB (same methods as DbService)

class MemoryDb {
  audits = new Map();
  runs = new Map();
  findings = [];

  async createAudit(input) {
    const audit = { id: randomUUID(), journey: "checkout", status: "running", error: null, price_shown: null, price_final: null, score: null, report_hash: null, precedents: {}, created_at: new Date().toISOString(), finished_at: null, ...input };
    this.audits.set(audit.id, audit);
    return { ...audit };
  }
  async getAudit(id) { const a = this.audits.get(id); return a ? { ...a } : null; }
  async listAudits() { return [...this.audits.values()].map((a) => ({ ...a })); }
  async claimAudit(id) {
    const a = this.audits.get(id);
    if (!a || a.status !== "running") return false;
    a.status = "finalizing";
    return true;
  }
  async finishAudit(id, patch) { Object.assign(this.audits.get(id), patch, { finished_at: new Date().toISOString() }); }
  async failAudit(id, error) {
    const a = this.audits.get(id);
    if (a && (a.status === "running" || a.status === "finalizing")) Object.assign(a, { status: "failed", error });
  }
  async upsertRun(input) {
    let run = [...this.runs.values()].find((r) => r.audit_id === input.audit_id && r.session === input.session);
    if (!run) {
      run = { id: randomUUID(), status: "PENDING", started_at: null, num_steps: null, result: null, error: null, created_at: new Date().toISOString() };
      this.runs.set(run.id, run);
    }
    Object.assign(run, input);
    // Pretend B started 2m05s after A (the real gap), not the test's 1.5 s, so the restarted-timer rule can fire.
    if (input.session === "B" && input.started_at) run.started_at = new Date(Date.parse(input.started_at) + 125_000).toISOString();
    return { ...run };
  }
  async getRuns(auditId) {
    return [...this.runs.values()].filter((r) => r.audit_id === auditId).sort((a, b) => a.session.localeCompare(b.session)).map((r) => ({ ...r }));
  }
  async updateRun(id, patch) { Object.assign(this.runs.get(id), patch); }
  async insertFindings(auditId, list) {
    for (const f of list) this.findings.push({ id: randomUUID(), audit_id: auditId, created_at: new Date().toISOString(), ...f });
  }
  async getFindings(auditId) { return this.findings.filter((f) => f.audit_id === auditId); }
  steps = [];
  screens = new Map();
  async uploadScreenshot(path, jpeg) { this.screens.set(path, jpeg); }
  screenshotUrl(path) { return `https://storage.example/screens/${path}`; }
  async upsertStep(step) { this.steps = this.steps.filter((s) => !(s.run_id === step.run_id && s.idx === step.idx)).concat(step); }
  async getSteps(runIds) { return this.steps.filter((s) => runIds.includes(s.run_id)).sort((a, b) => a.idx - b.idx); }
  precedentRows = new Map();
  async getPrecedents(pattern) { return this.precedentRows.get(pattern) ?? null; }
  async savePrecedents(pattern, results) { this.precedentRows.set(pattern, { pattern, results, fetched_at: new Date().toISOString() }); }
}

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
const api = (path, init = {}) =>
  fetch(`${baseUrl}${path}`, { ...init, headers: { "content-type": "application/json", "x-api-key": "test-key", ...(init.headers ?? {}) } });

before(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRole("all")] })
    .overrideProvider(DbService)
    .useValue(db)
    .overrideProvider(RUN_JOURNEY)
    .useValue(stubRunJourney)
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
