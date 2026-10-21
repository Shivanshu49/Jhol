"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PATTERNS, rupees, type AuditView, type Finding, type Run } from "@/lib/types";

const ACTIVE = new Set(["running", "finalizing"]);

const SEVERITY_STYLE: Record<string, string> = {
  high: "bg-red-100 text-red-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-stone-200 text-stone-700",
};

const RUN_LABEL: Record<string, string> = {
  PENDING: "Starting a cloud browser…",
  RUNNING: "Shopping like a real customer…",
  COMPLETED: "Done",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export function AuditReport({ id }: { id: string }) {
  const [view, setView] = useState<AuditView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const res = await fetch(`/api/audits/${id}`, { cache: "no-store" });
        if (!res.ok) throw new Error(res.status === 404 ? "Audit not found" : `API error ${res.status}`);
        const data = (await res.json()) as AuditView;
        if (stopped) return;
        setView(data);
        setError(null);
        if (ACTIVE.has(data.audit.status)) timer = setTimeout(tick, 2500);
      } catch (err) {
        if (stopped) return;
        setError((err as Error).message);
        timer = setTimeout(tick, 5000);
      }
    };

    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  if (!view) return <p className="text-ink/60">{error ?? "Loading audit…"}</p>;

  const { audit, runs, findings } = view;
  const active = ACTIVE.has(audit.status);
  const live = runs.find((r) => r.streaming_url && (r.status === "RUNNING" || r.status === "PENDING"));
  const sessionB = runs.find((r) => r.session === "B");

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link href="/" className="text-sm text-ink/60 hover:text-ink">
          ← New audit
        </Link>
        <h1 className="break-all text-2xl font-black">{audit.url}</h1>
        <p className="text-sm text-ink/60">
          {statusText(audit.status)} · started {new Date(audit.created_at).toLocaleString("en-IN")}
        </p>
        {error && <p className="text-sm text-amber-700">Connection issue: {error}. Retrying…</p>}
      </div>

      {audit.status === "failed" && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Audit failed: {audit.error ?? "unknown error"}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
        {runs.map((run) => (
          <SessionCard key={run.id} run={run} />
        ))}
        {audit.sessions === 2 && !sessionB && active && (
          <div className="rounded-2xl border border-dashed border-ink/20 p-4 text-sm text-ink/60">
            <p className="font-semibold text-ink">Visit B</p>
            Starts about 2 minutes after visit A, to check whether timers and stock counts are real.
          </div>
        )}
      </section>

      {live?.streaming_url && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-widest text-ink/50">Live: visit {live.session}</h2>
            <a href={live.streaming_url} target="_blank" rel="noreferrer" className="text-sm text-brand underline">
              Open in new tab ↗
            </a>
          </div>
          <iframe
            src={live.streaming_url}
            title={`Live browser, visit ${live.session}`}
            className="aspect-video w-full rounded-2xl border border-ink/10 bg-white"
          />
        </section>
      )}

      {audit.status === "done" && <Report view={view} findings={findings} />}
    </div>
  );
}

function SessionCard({ run }: { run: Run }) {
  return (
    <div className="space-y-1 rounded-2xl border border-ink/10 bg-white p-4 text-sm">
      <p className="font-semibold">Visit {run.session}</p>
      <p className={run.status === "FAILED" ? "text-red-700" : "text-ink/70"}>
        {RUN_LABEL[run.status] ?? run.status}
        {run.status === "FAILED" && run.error ? `: ${run.error}` : ""}
      </p>
      {run.pages.length > 0 && <p className="text-ink/60">Path: {run.pages.join(" → ")}</p>}
      {run.num_steps !== null && <p className="text-ink/50">{run.num_steps} agent steps</p>}
      {run.video_url && (
        <a href={run.video_url} target="_blank" rel="noreferrer" className="text-brand underline">
          Recording ↗
        </a>
      )}
    </div>
  );
}

function Report({ view, findings }: { view: AuditView; findings: Finding[] }) {
  const { audit } = view;
  const shown = audit.price_shown;
  const final = audit.price_final;
  const extra = shown !== null && final !== null ? final - shown : null;
  const score = audit.score ?? 0;
  const scoreColor = score >= 80 ? "text-green-700" : score >= 50 ? "text-amber-700" : "text-red-700";

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-ink/10 bg-white p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-ink/50">Price shown → price you pay</p>
          {shown !== null && final !== null && extra !== null ? (
            <>
              <p className="mt-2 text-3xl font-black">
                {rupees(shown)} → {rupees(final)}
              </p>
              <p className={extra > 0 ? "font-semibold text-red-700" : "text-ink/60"}>
                {extra > 0 ? `+${rupees(extra)} (+${Math.round((extra / shown) * 1000) / 10}%) added during checkout` : "No change"}
              </p>
            </>
          ) : (
            <p className="mt-2 text-ink/60">The agent couldn&apos;t read two prices to compare.</p>
          )}
        </div>
        <div className="rounded-2xl border border-ink/10 bg-white p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-ink/50">Jhol score</p>
          <p className={`mt-2 text-3xl font-black ${scoreColor}`}>{score}/100</p>
          <p className="text-ink/60">
            {findings.length} finding{findings.length === 1 ? "" : "s"} · 100 means no dark patterns found
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-ink/50">Findings</h2>
        {findings.length === 0 ? (
          <p className="rounded-2xl border border-ink/10 bg-white p-5 text-ink/70">No dark patterns found on this journey.</p>
        ) : (
          <ul className="space-y-3">
            {findings.map((f) => (
              <FindingCard key={f.id} finding={f} />
            ))}
          </ul>
        )}
      </section>

      {audit.report_hash && (
        <p className="break-all text-xs text-ink/50">
          Report sealed · SHA-256 <span className="font-mono">{audit.report_hash}</span>
        </p>
      )}
    </div>
  );
}

function FindingCard({ finding: f }: { finding: Finding }) {
  const pattern = PATTERNS[f.pattern] ?? { label: f.pattern, what: "" };
  return (
    <li className="space-y-2 rounded-2xl border border-ink/10 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">{pattern.label}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${SEVERITY_STYLE[f.severity] ?? ""}`}>
          {f.severity}
        </span>
        <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">
          {f.source === "llm" ? "AI judge" : "rule"}
        </span>
        {f.page && <span className="text-xs text-ink/50">on {f.page}</span>}
      </div>
      {f.evidence && (
        <blockquote className="rounded-lg bg-paper px-3 py-2 font-mono text-sm">{f.evidence}</blockquote>
      )}
      {f.detail && <p className="text-sm text-ink/70">{f.detail}</p>}
    </li>
  );
}

function statusText(status: string) {
  if (status === "running") return "Auditing";
  if (status === "finalizing") return "Analysing findings";
  if (status === "done") return "Audit complete";
  return "Audit failed";
}
