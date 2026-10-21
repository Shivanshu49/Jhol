import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Finding, JourneyResult } from "@jhol/core";
import type { Session } from "./queue";

export type AuditStatus = "running" | "finalizing" | "done" | "failed";
export type AuditOptions = { stealth?: boolean; indiaProxy?: boolean; pincode?: string };

export type AuditRow = {
  id: string;
  url: string;
  journey: string;
  sessions: number;
  options: AuditOptions;
  status: AuditStatus;
  error: string | null;
  price_shown: number | null;
  price_final: number | null;
  score: number | null;
  report_hash: string | null;
  created_at: string;
  finished_at: string | null;
};

export type RunRow = {
  id: string;
  audit_id: string;
  session: Session;
  tinyfish_run_id: string | null;
  status: string;
  streaming_url: string | null;
  video_url: string | null;
  started_at: string | null;
  num_steps: number | null;
  result: JourneyResult | null;
  error: string | null;
  created_at: string;
};

export type FindingRow = Finding & { id: string; audit_id: string; created_at: string };

type Res<T> = { data: T | null; error: { message: string } | null };

/** Thin Supabase (Postgres) layer. Uses the secret/service_role key — server only. */
@Injectable()
export class DbService {
  private readonly sb: SupabaseClient;

  constructor(config: ConfigService) {
    this.sb = createClient(config.getOrThrow<string>("SUPABASE_URL"), config.getOrThrow<string>("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  private must<T>(res: Res<T>, what: string): T {
    if (res.error) throw new Error(`${what}: ${res.error.message}`);
    return res.data as T;
  }

  // ---------- audits ----------

  async createAudit(input: { url: string; sessions: number; options: AuditOptions }): Promise<AuditRow> {
    return this.must(await this.sb.from("audits").insert(input).select().single(), "create audit");
  }

  async getAudit(id: string): Promise<AuditRow | null> {
    return this.must(await this.sb.from("audits").select("*").eq("id", id).maybeSingle(), "get audit");
  }

  async listAudits(limit = 20): Promise<AuditRow[]> {
    return this.must(
      await this.sb.from("audits").select("*").order("created_at", { ascending: false }).limit(limit),
      "list audits",
    );
  }

  /** running → finalizing exactly once. False means another job already claimed it. */
  async claimAudit(id: string): Promise<boolean> {
    const rows = this.must(
      await this.sb.from("audits").update({ status: "finalizing" }).eq("id", id).eq("status", "running").select("id"),
      "claim audit",
    );
    return rows.length === 1;
  }

  async finishAudit(id: string, patch: Partial<AuditRow>): Promise<void> {
    this.must(
      await this.sb.from("audits").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", id).select("id"),
      "finish audit",
    );
  }

  async failAudit(id: string, error: string): Promise<void> {
    this.must(
      await this.sb
        .from("audits")
        .update({ status: "failed", error, finished_at: new Date().toISOString() })
        .eq("id", id)
        .in("status", ["running", "finalizing"])
        .select("id"),
      "fail audit",
    );
  }

  // ---------- runs ----------

  async upsertRun(input: {
    audit_id: string;
    session: Session;
    tinyfish_run_id: string | null;
    status?: string;
    error?: string;
  }): Promise<RunRow> {
    return this.must(
      await this.sb.from("runs").upsert(input, { onConflict: "audit_id,session" }).select().single(),
      "upsert run",
    );
  }

  async getRun(id: string): Promise<RunRow | null> {
    return this.must(await this.sb.from("runs").select("*").eq("id", id).maybeSingle(), "get run");
  }

  async getRunByTinyfishId(tinyfishRunId: string): Promise<RunRow | null> {
    return this.must(
      await this.sb.from("runs").select("*").eq("tinyfish_run_id", tinyfishRunId).maybeSingle(),
      "get run by tinyfish id",
    );
  }

  async getRuns(auditId: string): Promise<RunRow[]> {
    return this.must(await this.sb.from("runs").select("*").eq("audit_id", auditId).order("session"), "get runs");
  }

  async updateRun(id: string, patch: Partial<RunRow>): Promise<void> {
    this.must(await this.sb.from("runs").update(patch).eq("id", id).select("id"), "update run");
  }

  // ---------- findings ----------

  async insertFindings(auditId: string, findings: Finding[]): Promise<void> {
    if (!findings.length) return;
    this.must(
      await this.sb
        .from("findings")
        .insert(findings.map((f) => ({ ...f, audit_id: auditId })))
        .select("id"),
      "insert findings",
    );
  }

  async getFindings(auditId: string): Promise<FindingRow[]> {
    return this.must(
      await this.sb.from("findings").select("*").eq("audit_id", auditId).order("created_at"),
      "get findings",
    );
  }
}
