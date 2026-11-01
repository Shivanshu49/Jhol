const { randomUUID } = require("node:crypto");

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

  async claimFix(id) {
    const audit = this.audits.get(id);
    if (!audit || audit.status !== "done" || (audit.fix_status && audit.fix_status !== "failed")) return false;
    Object.assign(audit, { fix_status: "queued", fix_error: null, fix_pr_url: null, fix_branch: null, fixed_audit_id: null, fix_message: null, fix_diff_summary: null });
    return true;
  }
  async updateFix(id, patch, expectedStatus) {
    const audit = this.audits.get(id);
    if (!expectedStatus || audit.fix_status === expectedStatus) Object.assign(audit, patch);
  }
}

module.exports = { MemoryDb };
