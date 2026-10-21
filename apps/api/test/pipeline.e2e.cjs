// End-to-end check of the audit pipeline: real Nest app + real BullMQ/Redis,
// a fake TinyFish server and an in-memory database (no Supabase needed).
//
//   docker compose up -d                      # Redis on :6379
//   pnpm --filter @jhol/api build && pnpm --filter @jhol/api test:e2e
//
// Uses Redis DB 15 so it never touches your dev queue.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { randomUUID } = require("node:crypto");

process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/15";
process.env.JHOL_API_KEY = "test-key";
process.env.WEBHOOK_SECRET = "hook-secret";
process.env.PUBLIC_API_URL = "https://jhol-api.example";
process.env.SUPABASE_URL = "http://not-used.local";
process.env.SUPABASE_SERVICE_ROLE_KEY = "not-used";
process.env.TINYFISH_API_KEY = "fake-tinyfish-key";
process.env.ANTHROPIC_API_KEY = ""; // judge off: rule findings only
process.env.SESSION_B_DELAY_MS = "1500";
process.env.FIRST_CHECK_MS = "200";
process.env.POLL_EVERY_MS = "200";

const { Test } = require("@nestjs/testing");
const { getQueueToken } = require("@nestjs/bullmq");
const { AppModule } = require("../dist/app.module");
const { DbService } = require("../dist/common/db.service");

// ---------------------------------------------------------------- in-memory DB (same methods as DbService)

class MemoryDb {
  audits = new Map();
  runs = new Map();
  findings = [];

  async createAudit(input) {
    const audit = { id: randomUUID(), journey: "checkout", status: "running", error: null, price_shown: null, price_final: null, score: null, report_hash: null, created_at: new Date().toISOString(), finished_at: null, ...input };
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
      run = { id: randomUUID(), status: "PENDING", streaming_url: null, video_url: null, started_at: null, num_steps: null, result: null, error: null, created_at: new Date().toISOString() };
      this.runs.set(run.id, run);
    }
    Object.assign(run, input);
    return { ...run };
  }
  async getRun(id) { const r = this.runs.get(id); return r ? { ...r } : null; }
  async getRunByTinyfishId(t) { const r = [...this.runs.values()].find((x) => x.tinyfish_run_id === t); return r ? { ...r } : null; }
  async getRuns(auditId) {
    return [...this.runs.values()].filter((r) => r.audit_id === auditId).sort((a, b) => a.session.localeCompare(b.session)).map((r) => ({ ...r }));
  }
  async updateRun(id, patch) { Object.assign(this.runs.get(id), patch); }
  async insertFindings(auditId, list) {
    for (const f of list) this.findings.push({ id: randomUUID(), audit_id: auditId, created_at: new Date().toISOString(), ...f });
  }
  async getFindings(auditId) { return this.findings.filter((f) => f.audit_id === auditId); }
}

// ---------------------------------------------------------------- fake TinyFish

function chalakResult(session) {
  const urgency = session === "A" ? ["Deal ends in 04:52", "Only 3 left in stock!"] : ["Deal ends in 04:55", "Only 5 left in stock!"];
  const journey = {
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
  return session === "A" ? journey : { result: journey }; // B tests the result.result unwrapping
}

const fake = { runs: new Map(), requests: [] };
const tinyfish = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const send = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.headers["x-api-key"] !== "fake-tinyfish-key") return send(401, { error: "bad key" });

    if (req.method === "POST" && req.url === "/v1/automation/run-async") {
      const body = JSON.parse(raw);
      fake.requests.push(body);
      const id = `run_${fake.runs.size + 1}`;
      const session = fake.runs.size === 0 ? "A" : "B";
      fake.runs.set(id, { polls: 0, session, startedAt: session === "A" ? "2026-10-22T01:00:00Z" : "2026-10-22T01:02:05Z" });
      return send(200, { run_id: id, error: null });
    }
    const m = req.url.match(/^\/v1\/runs\/([^/]+)$/);
    if (req.method === "GET" && m && fake.runs.has(m[1])) {
      const run = fake.runs.get(m[1]);
      run.polls += 1;
      const base = { run_id: m[1], started_at: run.startedAt, video_url: null, error: null };
      if (run.polls < 3) return send(200, { ...base, status: "RUNNING", num_of_steps: run.polls * 4, streaming_url: `https://stream.example/${m[1]}`, result: null, finished_at: null });
      return send(200, { ...base, status: "COMPLETED", num_of_steps: 18, streaming_url: null, result: chalakResult(run.session), finished_at: new Date().toISOString() });
    }
    send(404, { error: "not found" });
  });
});

// ---------------------------------------------------------------- app

let app;
let baseUrl;
const db = new MemoryDb();
const api = (path, init = {}) =>
  fetch(`${baseUrl}${path}`, { ...init, headers: { "content-type": "application/json", "x-api-key": "test-key", ...(init.headers ?? {}) } });

before(async () => {
  await new Promise((resolve) => tinyfish.listen(0, "127.0.0.1", resolve));
  process.env.TINYFISH_API_BASE = `http://127.0.0.1:${tinyfish.address().port}/v1`;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRole("all")] })
    .overrideProvider(DbService)
    .useValue(db)
    .compile();
  app = moduleRef.createNestApplication({ logger: ["error"] });
  await app.listen(0, "127.0.0.1");
  baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  await app.get(getQueueToken("audits")).obliterate({ force: true });
});

after(async () => {
  await app?.close();
  tinyfish.close();
});

test("rejects calls without the shared API key", async () => {
  const res = await fetch(`${baseUrl}/audits`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(res.status, 401);
});

test("rejects private URLs", async () => {
  const res = await api("/audits", { method: "POST", body: JSON.stringify({ url: "http://localhost:3000/lab/chalak-mart.html" }) });
  assert.equal(res.status, 400);
});

test("runs a two-visit audit end to end", async () => {
  const created = await api("/audits", { method: "POST", body: JSON.stringify({ url: "https://chalak.example/lab/chalak-mart.html", sessions: 2, indiaProxy: true }) });
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
  assert.ok(view.runs.every((r) => r.streaming_url?.startsWith("https://stream.example/")), "live view URL kept");
  assert.equal(view.runs[0].pages.join(">"), "home>product>cart>review>payment");

  const count = (p) => view.findings.filter((f) => f.pattern === p).length;
  assert.equal(count("drip_pricing"), 2);
  assert.equal(count("basket_sneaking"), 2);
  assert.equal(count("subscription_trap"), 1);
  assert.equal(count("nagging"), 1);
  assert.equal(count("false_urgency"), 2);
  assert.equal(view.findings[0].severity, "high", "findings sorted by severity");

  // what we actually sent TinyFish
  const sent = fake.requests[0];
  assert.equal(sent.url, "https://chalak.example/lab/chalak-mart.html");
  assert.deepEqual(sent.proxy_config, { enabled: true, type: "tinyfish", country_code: "IN" });
  assert.equal(sent.webhook_url, "https://jhol-api.example/webhooks/tinyfish?token=hook-secret");
  assert.equal(sent.output_schema.type, "object");
  assert.equal(fake.requests.length, 2, "exactly two TinyFish runs (A and B)");
});

test("webhook needs the secret and only nudges known runs", async () => {
  const bad = await fetch(`${baseUrl}/webhooks/tinyfish?token=nope`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ run_id: "run_1" }) });
  assert.equal(bad.status, 401);
  const ok = await fetch(`${baseUrl}/webhooks/tinyfish?token=hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ run_id: "run_1" }) });
  assert.equal(ok.status, 200);
});
