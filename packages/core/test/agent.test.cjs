// Agent safety rules + payment detection (pure functions, no browser):  pnpm --filter @jhol/core test
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { refusal, paymentVisible, isPublicUrl, startGuardProxy } = require("../dist/index.js");

const el = (o) => ({ id: "e1", tag: "input", type: "text", name: "", text: "", label: "", checked: null, disabled: false, ...o });
const snap = (elements) => ({ url: "", title: "", headings: [], elements, priceLines: [], urgencyLines: [], dialogs: [], checked: [] });
const fill = { type: "fill", target: "e1", value: "x", reason: "" };
const click = { type: "click", target: "e1", value: null, reason: "" };

test("never types into card, CVV, UPI, OTP or password fields", () => {
  for (const e of [
    el({ type: "password", name: "pw" }),
    el({ name: "cardnumber" }),
    el({ name: "cc-csc" }),
    el({ label: "CVV" }),
    el({ label: "UPI ID" }),
    el({ text: "Enter OTP" }),
  ]) assert.ok(refusal(e, fill), JSON.stringify(e));
  assert.equal(refusal(el({ name: "pincode", label: "Pincode" }), fill), null);
  assert.equal(refusal(el({ type: "email", name: "email" }), fill), null);
});

test("never unticks a pre-selected checkbox", () => {
  assert.ok(refusal(el({ type: "checkbox", checked: true }), click));
  assert.equal(refusal(el({ type: "checkbox", checked: false }), click), null);
  assert.equal(refusal(el({ type: "radio", checked: true }), click), null);
});

test("detects the payment step, not a gift-card box", () => {
  const btn = (text) => el({ tag: "button", type: "", text });
  assert.ok(paymentVisible(snap([btn("UPI"), btn("Card"), btn("Cash on delivery")])));
  assert.ok(paymentVisible(snap([el({ name: "cardnumber", label: "Card number" })])));
  assert.ok(!paymentVisible(snap([el({ label: "Discount code or gift card" }), btn("Add to cart")])));
  assert.ok(paymentVisible(snap([btn("Cash on delivery")])));
  assert.ok(paymentVisible(snap([btn("Place order")])));
  assert.ok(!paymentVisible(snap([btn("Card offers"), btn("Continue to payment")])));
});

test("refuses final orders and payment selections even if the model asks", () => {
  for (const text of ["Place order", "Pay now", "Confirm and pay", "Complete purchase"]) {
    assert.ok(refusal(el({ tag: "button", text }), click), text);
  }
  assert.ok(refusal(el({ tag: "select", name: "card_expiry" }), { ...fill, type: "select" }));
  assert.equal(refusal(el({ tag: "button", text: "Continue to payment" }), click), null);
});

test("only public http(s) sites are reachable by default", async () => {
  for (const u of ["http://localhost:5050/", "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.5/",
    "http://192.168.1.1/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "file:///etc/passwd", "not a url"]) {
    assert.equal(await isPublicUrl(u), false, u);
  }
  assert.equal(await isPublicUrl("https://1.1.1.1/"), true);
});

test("guard proxy refuses internal targets over plain http and CONNECT", async () => {
  const internal = http.createServer((q, s) => s.end("INTERNAL SECRET")).listen(0, "127.0.0.1");
  await new Promise((r) => internal.once("listening", r));
  const target = `127.0.0.1:${internal.address().port}`;
  const proxy = await startGuardProxy();
  const { port } = new URL(proxy.server);
  const via = (opts) => new Promise((ok, fail) => {
    const req = http.request({ host: "127.0.0.1", port, ...opts });
    req.on("response", (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => ok({ status: r.statusCode, body: b })); });
    req.on("connect", (r, sock) => { sock.destroy(); ok({ status: r.statusCode }); });
    req.on("error", fail);
    req.end();
  });
  try {
    const plain = await via({ path: `http://${target}/`, headers: { host: target } });
    assert.equal(plain.status, 403);
    assert.ok(!plain.body.includes("SECRET"));
    for (const t of [target, "169.254.169.254:80", "[::1]:443", "localhost:443"]) {
      assert.equal((await via({ method: "CONNECT", path: t })).status, 403, t);
    }
  } finally {
    proxy.close();
    internal.close();
  }
});

test("validates model replies against the decision schema", () => {
  const { decisionError } = require("../dist/index.js");
  const ok = {
    page: "cart",
    page_data: { total_shown: 558, line_items: [{ label: "Order Protection", amount: 49 }], urgency_texts: [], choice_texts: [], popups: [] },
    product_added: null,
    action: { type: "click", target: "e6", value: null, reason: "checkout" },
  };
  assert.equal(decisionError(ok), null);
  const bad = (patch, msg) => assert.match(decisionError({ ...ok, ...patch }) ?? "", msg);
  bad({ page: 3 }, /reply\.page must be string/);
  bad({ action: { ...ok.action, type: "buy" } }, /reply\.action\.type must be one of/);
  bad({ page_data: { ...ok.page_data, line_items: [{ label: "x", amount: "49" }] } }, /line_items\[0\]\.amount must be number or null/);
  bad({ page_data: { ...ok.page_data, popups: undefined } }, /page_data\.popups must be array/);
  assert.match(decisionError([]), /reply must be object/);
});

test("model replies remain storable in PostgreSQL without corrupting valid Unicode", () => {
  const { parseDecision } = require("../dist/index.js");
  const reply = {
    page: "cart",
    page_data: { total_shown: 499, line_items: [{ label: "Cotton 👕 ₹499", amount: 499 }], urgency_texts: [], choice_texts: [], popups: ["Literal \\u0000 stays literal"] },
    product_added: null,
    action: { type: "click", target: "e1", value: null, reason: "Continue\u0000\uD800" },
  };
  const got = parseDecision(JSON.stringify(reply));
  assert.equal(got.action.reason, "Continue\uFFFD\uFFFD");
  assert.deepEqual(got.page_data, reply.page_data);
  assert.throws(() => parseDecision(JSON.stringify({ ...reply, page: 42 })), /reply.page must be string/);
});

test("precedents: trusted domains first, topped up from news, http(s) only, cached", async () => {
  const { findPrecedents, precedentQuery } = require("../dist/index.js");
  const r = (url, title, publishedDate) => ({ id: url, url, title, publishedDate, highlights: [`  CCPA   fined ${title} `] });
  const calls = [];
  const fake = {
    search: async (query, opts, req) => {
      calls.push({ query, opts, req });
      return opts.includeDomains
        ? { results: [r("https://pib.gov.in/a", "Govt notice", "2025-03-01")] }
        : { results: [r("https://pib.gov.in/a", "dupe"), r("javascript:alert(1)", "evil"), r("https://news.example/b", "News B"), r("https://news.example/c", "News C")] };
    },
  };
  const got = await findPrecedents("drip_pricing", fake);
  assert.deepEqual(got.map((p) => p.url), ["https://pib.gov.in/a", "https://news.example/b", "https://news.example/c"]);
  assert.equal(got[0].snippet, "CCPA fined Govt notice");
  assert.equal(got[0].publishedDate, "2025-03-01");
  assert.equal(calls.length, 2);
  assert.ok(calls[0].opts.includeDomains.includes("pib.gov.in") && calls[1].opts.category === "news");
  assert.match(calls[0].query, /^CCPA India penalty notice drip pricing hidden fees dark pattern e-commerce$/);
  assert.equal(calls[0].req.timeout, 8000);

  await findPrecedents("drip_pricing", fake);
  assert.equal(calls.length, 2, "second lookup within a day is served from memory");

  const saved = process.env.EXA_API_KEY;
  delete process.env.EXA_API_KEY;
  await assert.rejects(findPrecedents("nagging"), /EXA_API_KEY/);
  if (saved !== undefined) process.env.EXA_API_KEY = saved;
  assert.match(precedentQuery("basket_sneaking"), /basket sneaking pre-selected donation/);
});

test("one item labelled differently on cart and review is counted once", () => {
  const { canonicaliseItems, matchAdded, runRuleDetectors } = require("../dist/index.js");
  const step = (page, total_shown, line_items, preselected = []) => ({ page, total_shown, line_items, preselected, urgency_texts: [], choice_texts: [], popups: [] });
  // labels as gpt-4.1-mini returned them in a real Chalak Mart run
  const steps = [
    step("product", 499, [{ label: "Cotton Crew Tee", amount: 499 }]),
    step("cart", 558, [
      { label: "Cotton Crew Tee × 1", amount: 499 },
      { label: "Donation to Green India Fund remove", amount: 10 },
      { label: "Order Protection (₹49): covers loss in transit", amount: 49 },
      { label: "Start ChalakPlus 7-day free trial: ₹0 today Renews at ₹199/month after 7 days unless cancelled.", amount: 0 },
      { label: "Donation to Green India Fund", amount: 10 },
    ], [
      { label: "Order Protection (₹49): covers loss in transit", amount: 49 },
      { label: "Start ChalakPlus 7-day free trial: ₹0 today Renews at ₹199/month after 7 days unless cancelled.", amount: 0 },
    ]),
    step("review", 606, [
      { label: "Cotton Crew Tee × 1", amount: 499 },
      { label: "Donation to Green India Fund", amount: 10 },
      { label: "Order Protection", amount: 49 },
      { label: "ChalakPlus 7-day free trial", amount: 0 },
      { label: "Platform fee", amount: 19 },
      { label: "Handling fee", amount: 29 },
    ]),
  ];
  canonicaliseItems(steps);
  assert.deepEqual(steps[1].line_items.map((li) => li.label), ["Cotton Crew Tee", "Donation to Green India Fund", "Order Protection", "ChalakPlus 7-day free trial"]);
  assert.equal(matchAdded("Cotten Crew Tee", steps), "Cotton Crew Tee"); // typo from a real run
  assert.equal(matchAdded("Cotton Crew Tee", steps), "Cotton Crew Tee");
  assert.equal(matchAdded("Steel Water Bottle", steps), "Steel Water Bottle");
  const result = { reached_payment_page: true, stop_reason: "", items_added_by_agent: [matchAdded("Cotten Crew Tee", steps)], steps };
  const count = {};
  for (const f of runRuleDetectors({ result, startedAt: new Date() }).findings) count[f.pattern] = (count[f.pattern] ?? 0) + 1;
  assert.deepEqual(count, { drip_pricing: 2, basket_sneaking: 2, subscription_trap: 1 });
});
