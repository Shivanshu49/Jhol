// Runs against the built package:  pnpm --filter @jhol/core test
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { toJourney, JOURNEY_SCHEMA, runRuleDetectors, jholScore, buildJudgePrompt, parseJudge, sealReport } = require("../dist/index.js");

// A plausible TinyFish result for the Chalak Mart test store (wrapped in result.result, one string line item)
function chalakSession(urgency) {
  return {
    result: {
      reached_payment_page: true,
      stop_reason: "Reached payment step",
      items_added_by_agent: ["Cotton Crew Tee"],
      steps: [
        { page: "home", total_shown: null, line_items: [], preselected: [], urgency_texts: [], choice_texts: ["Join now", "Not now"], popups: ["Get 10% off your first order! Join the Chalak Club for secret deals in your inbox."] },
        { page: "product", total_shown: 499, line_items: [{ label: "Cotton Crew Tee", amount: 499 }], preselected: [], urgency_texts: urgency, choice_texts: [], popups: ["Get 10% off your first order! Join the Chalak Club"] },
        { page: "cart", total_shown: 558, line_items: [{ label: "Cotton Crew Tee × 1", amount: 499 }, "Donation to Green India Fund | 10"], preselected: [{ label: "Order Protection", amount: 49 }, { label: "ChalakPlus 7-day free trial", amount: 0 }], urgency_texts: [], choice_texts: ["Yes, protect my order", "No thanks, I don't mind if my order arrives broken"], popups: ["Get 10% off your first order! Join the Chalak Club for secret deals", "Wait! Protect your order? Add Damage Shield for just ₹39"] },
        { page: "checkout", total_shown: null, line_items: [], preselected: [], urgency_texts: [], choice_texts: [], popups: ["Get 10% off your first order!"] },
        { page: "review", total_shown: 606, line_items: [{ label: "Cotton Crew Tee × 1", amount: 499 }, { label: "Donation to Green India Fund", amount: 10 }, { label: "Order Protection", amount: 49 }, { label: "ChalakPlus 7-day free trial", amount: 0 }, { label: "Platform fee", amount: 19 }, { label: "Handling fee", amount: 29 }, { label: "Delivery", amount: 0 }, { label: "Total payable", amount: 606 }], preselected: [], urgency_texts: [], choice_texts: [], popups: ["Get 10% off your first order! Join the Chalak Club"] },
        { page: "payment", total_shown: 606, line_items: [{ label: "Amount payable", amount: 606 }], preselected: [], urgency_texts: [], choice_texts: [], popups: [] },
      ],
    },
  };
}

const A = { result: toJourney(chalakSession(["Deal ends in 04:52", "Only 3 left in stock!"])), startedAt: "2026-10-22T01:00:00Z" };
const B = { result: toJourney(chalakSession(["Deal ends in 04:55", "Only 5 left in stock!"])), startedAt: "2026-10-22T01:02:05Z" };

test("normaliser unwraps result.result and parses string line items", () => {
  assert.ok(A.result);
  assert.deepEqual(A.result.steps[2].line_items[1], { label: "Donation to Green India Fund", amount: 10 });
});

test("catches every rule-based pattern planted in Chalak Mart", () => {
  const { findings, drift } = runRuleDetectors(A, B);
  const has = (pattern, text) => findings.some((f) => f.pattern === pattern && f.evidence.includes(text));
  assert.deepEqual([drift.shown, drift.final, drift.extra, drift.pct], [499, 606, 107, 21.4]);
  assert.ok(has("drip_pricing", "Platform fee"));
  assert.ok(has("drip_pricing", "Handling fee"));
  assert.ok(has("basket_sneaking", "Donation"));
  assert.ok(has("basket_sneaking", "Order Protection"));
  assert.ok(has("subscription_trap", "ChalakPlus"));
  assert.ok(has("false_urgency", "Deal ends"));
  assert.ok(has("false_urgency", "Only"));
  assert.equal(findings.find((f) => f.pattern === "nagging").page, "home, product, cart, checkout, review");
  assert.ok(!findings.some((f) => /Cotton Crew Tee|Delivery|Total/.test(f.evidence)), "no false positives");
});

test("clean store produces no findings", () => {
  const clean = toJourney({
    reached_payment_page: true, stop_reason: "payment", items_added_by_agent: ["Steel Bottle"],
    steps: [
      { page: "product", total_shown: 699, line_items: [{ label: "Steel Bottle", amount: 649 }, { label: "Delivery fee", amount: 50 }], preselected: [{ label: "Size: 1L", amount: null }], urgency_texts: [], choice_texts: [], popups: [] },
      { page: "payment", total_shown: 699, line_items: [{ label: "Steel Bottle", amount: 649 }, { label: "Delivery fee", amount: 50 }, { label: "GST included", amount: 99 }], preselected: [], urgency_texts: [], choice_texts: [], popups: [] },
    ],
  });
  const s = (t) => ({ result: clean, startedAt: t });
  const { findings } = runRuleDetectors(s("2026-10-22T01:00:00Z"), s("2026-10-22T01:02:00Z"));
  assert.deepEqual(findings, []);
  assert.equal(jholScore(findings), 100);
});

test("LLM judge keeps real quotes and drops invented ones", () => {
  assert.ok(buildJudgePrompt(A.result).includes("No thanks, I don't mind if my order arrives broken"));
  const reply = 'Here you go\n{"findings":[' +
    '{"pattern":"confirm_shaming","page":"cart","evidence":"No thanks, I don\'t mind if my order arrives broken","detail":"Guilt-trips the decline.","severity":"high"},' +
    '{"pattern":"trick_question","page":"cart","evidence":"Uncheck to not opt out","detail":"invented","severity":"high"}]}';
  const kept = parseJudge(reply, A.result);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].pattern, "confirm_shaming");
});

test("report seal is a SHA-256 hex digest and schema fits TinyFish limits", async () => {
  assert.match(await sealReport({ a: 1 }), /^[0-9a-f]{64}$/);
  assert.ok(JSON.stringify(JOURNEY_SCHEMA).length < 64 * 1024);
});
