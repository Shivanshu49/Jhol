const { test } = require("node:test");
const assert = require("node:assert/strict");
const { caseCaught, summarize } = require("../dist/eval.js");

test("evals distinguish planted cases sharing a pattern and exclude unsupported vision", () => {
  const findings = [{ pattern: "basket_sneaking", evidence: "Donation to Green India Fund", detail: "" },
    { pattern: "false_urgency", evidence: "Only 1 left in stock → Only 4 left in stock", detail: "Stock went UP" },
    { pattern: "drip_pricing", evidence: "Platform fee", detail: "" }];
  assert.equal(caseCaught("P3", findings), true);
  assert.equal(caseCaught("P4", findings), false);
  assert.equal(caseCaught("P1", findings), false);
  assert.equal(caseCaught("P2", findings), true);
  assert.equal(caseCaught("P8", findings), false, "both hidden fees must be caught");
  const planted = [{ id: "P3", pattern: "basket_sneaking" }, { id: "P4", pattern: "basket_sneaking" }, { id: "P7", pattern: "interface_interference" }];
  const result = summarize(planted, [{ findings, steps: 10, seconds: 30 }, { findings: [], steps: 20, seconds: 50 }]);
  assert.equal(result.caught, 1);
  assert.equal(result.possible, 4);
  assert.equal(result.catchRate, 25);
  assert.equal(result.averageSteps, 15);
  assert.equal(result.averageSeconds, 40);
  assert.equal(result.cases[2].caught, null);
});
