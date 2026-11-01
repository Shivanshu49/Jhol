"use client";

import { animate, motion, useReducedMotion, type Variants } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CodexFix, FIX_ACTIVE } from "@/components/codex-fix";
import { AuditSteps } from "@/components/audit-steps";
import { PATTERNS, rupees, type AuditView, type Finding, type Precedent, type Run } from "@/lib/types";

const ACTIVE = new Set(["running", "finalizing"]);

const SEVERITY_STYLE: Record<string, string> = {
  high: "bg-primary/10 text-primary",
  medium: "bg-secondary/10 text-secondary",
  low: "bg-accent/5 text-ink",
};

const RUN_LABEL: Record<string, string> = {
  PENDING: "Starting a cloud browser…",
  RUNNING: "Shopping like a real customer…",
  COMPLETED: "Done",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

const listVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
};

export function AuditReport({ id }: { id: string }) {
  const [view, setView] = useState<AuditView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const reduce = Boolean(useReducedMotion());

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
        if (ACTIVE.has(data.audit.status) || FIX_ACTIVE.has(data.audit.fix_status ?? "")) timer = setTimeout(tick, 2500);
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
  }, [id, refreshKey]);

  if (!view) {
    return (
      <div className="space-y-5">
        <p className="text-sm text-white/70">{error ?? "Loading audit…"}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1].map((n) => (
            <div key={n} className="h-28 animate-pulse rounded-2xl border border-ink/10 bg-white" />
          ))}
        </div>
        <div className="h-36 animate-pulse rounded-2xl border border-ink/10 bg-white" />
      </div>
    );
  }

  const { audit, runs, findings } = view;
  const active = ACTIVE.has(audit.status);
  const live = runs.find((r) => r.streaming_url && (r.status === "RUNNING" || r.status === "PENDING"));
  const sessionB = runs.find((r) => r.session === "B");

  return (
    <div className="space-y-8">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="space-y-2"
      >
        <Link href="/" className="text-sm text-white/70 transition-colors hover:text-white">
          ← New audit
        </Link>
        <h1 className="break-all text-2xl font-black sm:text-3xl">{audit.url}</h1>
        <p className="text-sm text-white/70">
          {statusText(audit.status)} · started{" "}
          {new Date(audit.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
        </p>
        {error && <p className="text-sm font-medium text-primary">Connection issue: {error}. Retrying…</p>}
      </motion.div>

      {audit.status === "failed" && (
        <motion.div
          initial={reduce ? false : { opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-2xl border border-primary/25 bg-primary/10 p-4 text-sm text-primary"
        >
          Audit failed: {audit.error ?? "unknown error"}
        </motion.div>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
        {runs.map((run, index) => (
          <SessionCard key={run.id} run={run} index={index} />
        ))}
        {audit.sessions === 2 && !sessionB && active && (
          <motion.div
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-2xl border border-dashed border-white/25 p-4 text-sm text-white/70"
          >
            <p className="font-semibold text-white">Visit B</p>
            Starts about 2 minutes after visit A, to check whether timers and stock counts are real.
          </motion.div>
        )}
      </section>

      {live?.streaming_url && (
        <motion.section
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="space-y-2"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-widest text-white/70">Live: visit {live.session}</h2>
            <a href={live.streaming_url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-primary underline transition-colors hover:text-primary-hover">
              Open in new tab ↗
            </a>
          </div>
          <div className="relative overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-sm">
            <iframe
              src={live.streaming_url}
              title={`Live browser, visit ${live.session}`}
              className="aspect-video w-full bg-white"
            />
            <span className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-accent/85 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-secondary" />
              Live browser
            </span>
          </div>
        </motion.section>
      )}

      <AuditSteps runs={runs} />
      {audit.status === "done" && <Report view={view} findings={findings} />}
      {audit.status === "done" && <CodexFix view={view} onQueued={() => setRefreshKey((n) => n + 1)} />}
    </div>
  );
}

function SessionCard({ run, index }: { run: Run; index: number }) {
  const reduce = useReducedMotion();
  const failed = run.status === "FAILED";
  const running = run.status === "RUNNING" || run.status === "PENDING";

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: reduce ? 0 : index * 0.08 }}
      className={`relative space-y-1 overflow-hidden rounded-2xl border bg-white p-4 text-sm text-ink ${
        failed ? "border-primary/30" : running ? "border-secondary/30" : "border-ink/10"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">Visit {run.session}</p>
        <span className="relative flex h-2 w-2">
          {running && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
          )}
          <span
            className={`relative inline-flex h-2 w-2 rounded-full ${
              failed ? "bg-accent" : running ? "bg-primary" : "bg-secondary"
            }`}
            aria-hidden
          />
        </span>
      </div>
      <p className={failed ? "font-medium text-primary" : "text-ink/70"}>
        {RUN_LABEL[run.status] ?? run.status}
        {failed && run.error ? `: ${run.error}` : ""}
      </p>
      {run.pages.length > 0 && <p className="text-ink/60">Path: {run.pages.join(" → ")}</p>}
      {run.num_steps !== null && <p className="text-ink/50">{run.num_steps} agent steps</p>}
      {run.video_url && (
        <a href={run.video_url} target="_blank" rel="noreferrer" className="font-semibold text-primary underline transition-colors hover:text-primary-hover">
          Recording ↗
        </a>
      )}
    </motion.div>
  );
}

function Report({ view, findings }: { view: AuditView; findings: Finding[] }) {
  const { audit } = view;
  const reduce = useReducedMotion();
  const score = audit.score ?? 0;

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35 }}
      className="space-y-6"
    >
      <section className="grid gap-3 sm:grid-cols-[1.35fr_1fr]">
        <PriceCard shown={audit.price_shown} final={audit.price_final} />
        <ScoreCard score={score} findingsCount={findings.length} />
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-sm font-bold uppercase tracking-widest text-white/70">Findings</h2>
          <span className="text-[11px] font-medium text-white/60">
            {findings.length} finding{findings.length === 1 ? "" : "s"}
          </span>
        </div>

        {findings.length === 0 ? (
          <motion.p
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-ink/10 bg-white p-5 text-ink"
          >
            No dark patterns found on this journey.
          </motion.p>
        ) : (
          <motion.ul
            key={findings.length}
            variants={reduce ? undefined : listVariants}
            initial={reduce ? false : "hidden"}
            animate={reduce ? undefined : "show"}
            className="space-y-3"
          >
            {findings.map((finding) => (
              <FindingCard key={finding.id} finding={finding} precedents={view.precedents?.[finding.pattern] ?? []} />
            ))}
          </motion.ul>
        )}
      </section>

      {audit.report_hash && (
        <motion.p
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: reduce ? 0 : 0.5 }}
          className="break-all text-xs text-white/55"
        >
          Report sealed · SHA-256 <span className="font-mono">{audit.report_hash}</span>
        </motion.p>
      )}
    </motion.div>
  );
}

function PriceCard({ shown, final }: { shown: number | null; final: number | null }) {
  const reduce = useReducedMotion();
  const shownCount = useCountUp(shown);
  const finalCount = useCountUp(final);
  const extra = shown !== null && final !== null ? final - shown : null;

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      className="relative overflow-hidden rounded-2xl border border-ink/10 bg-white p-5 text-ink"
    >
      <div className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-primary/10 blur-2xl" aria-hidden />
      <p className="text-xs font-bold uppercase tracking-widest text-ink/50">Price shown → price you pay</p>

      {shown !== null && final !== null && extra !== null ? (
        <>
          <div className="mt-2 flex items-end gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink/35">Shown</p>
              <p className="text-xl font-black text-ink/45">{rupees(Math.round(shownCount))}</p>
            </div>
            <motion.span
              initial={reduce ? false : { opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.25 }}
              className="pb-1.5 text-ink/30"
              aria-hidden
            >
              →
            </motion.span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">Paid</p>
              <p className="text-3xl font-black leading-none">{rupees(Math.round(finalCount))}</p>
            </div>
          </div>

          <motion.p
            initial={reduce ? false : { opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.45, type: "spring", stiffness: 300, damping: 22 }}
            className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
              extra > 0 ? "bg-primary/10 text-primary" : "bg-secondary/10 text-secondary"
            }`}
          >
            {extra > 0
              ? `+${rupees(extra)} (${shown > 0 ? `+${Math.round((extra / shown) * 1000) / 10}%` : "more"}) added during checkout`
              : "No change"}
          </motion.p>
        </>
      ) : (
        <p className="mt-2 text-ink/60">The agent couldn&apos;t read two prices to compare.</p>
      )}
    </motion.div>
  );
}

function ScoreCard({ score, findingsCount }: { score: number; findingsCount: number }) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.08 }}
      className="flex items-center gap-4 rounded-2xl border border-white/10 bg-accent p-5 text-white"
    >
      <ScoreRing score={score} />
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-widest text-white/80">Jhol score</p>
        <p className="mt-1 text-sm text-white/75">
          {findingsCount} finding{findingsCount === 1 ? "" : "s"} on this journey
        </p>
        <p className="mt-0.5 text-[10px] text-white/55">100 means no dark patterns found</p>
      </div>
    </motion.div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const reduce = useReducedMotion();
  const count = useCountUp(score, 1.1);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const stroke = score >= 80 ? "stroke-secondary" : score >= 50 ? "stroke-primary" : "stroke-white/70";

  return (
    <div className="relative grid h-24 w-24 shrink-0 place-items-center">
      <svg viewBox="0 0 100 100" className="h-24 w-24 -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={radius} fill="none" strokeWidth="8" className="stroke-white/20" />
        <motion.circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          className={stroke}
          initial={reduce ? false : { strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - score / 100) }}
          transition={{ duration: 1.1, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute text-center">
        <p className="text-2xl font-black leading-none text-white">{Math.round(count)}</p>
        <p className="mt-0.5 text-[10px] font-medium text-white/55">/ 100</p>
      </div>
    </div>
  );
}

function FindingCard({ finding: f, precedents }: { finding: Finding; precedents: Precedent[] }) {
  const reduce = useReducedMotion();
  const pattern = PATTERNS[f.pattern] ?? { label: f.pattern, what: "" };

  return (
    <motion.li
      variants={reduce ? undefined : cardVariants}
      whileHover={reduce ? undefined : { y: -2 }}
      className="space-y-2 rounded-2xl border border-ink/10 bg-white p-4 text-ink shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">{pattern.label}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${SEVERITY_STYLE[f.severity] ?? ""}`}>
          {f.severity}
        </span>
        <span className="rounded-full bg-secondary/25 px-2 py-0.5 text-xs font-semibold text-ink">
          {f.source === "llm" ? "AI judge" : "rule"}
        </span>
        {f.page && <span className="text-xs text-ink/50">on {f.page}</span>}
      </div>
      {f.evidence && (
        <blockquote className="rounded-lg border-l-2 border-primary/40 bg-paper px-3 py-2 font-mono text-sm">
          {f.evidence}
        </blockquote>
      )}
      {f.detail && <p className="text-sm text-ink/70">{f.detail}</p>}
      {pattern.what && <p className="text-[10px] font-medium uppercase tracking-wider text-ink/35">{pattern.what}</p>}
      {precedents.length > 0 && (
        <div className="border-t border-dashed border-ink/15 pt-2">
          <p className="text-xs font-bold uppercase tracking-widest text-ink/50">Regulators have acted on this before</p>
          <ul className="mt-1 space-y-1 text-sm">
            {precedents.slice(0, 2).map((precedent) => (
              <li key={precedent.url}>
                <a
                  href={precedent.url}
                  target="_blank"
                  rel="noreferrer"
                  title={precedent.snippet || undefined}
                  className="text-bluepen underline underline-offset-2 hover:no-underline"
                >
                  {precedent.title}
                </a>
                {shortDate(precedent.publishedDate) && <span className="text-ink/50"> · {shortDate(precedent.publishedDate)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </motion.li>
  );
}

function shortDate(iso?: string) {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : "";
}

function useCountUp(target: number | null, duration = 0.9) {
  const reduce = useReducedMotion();
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (target === null) return;
    if (reduce) {
      setValue(target);
      return;
    }
    const controls = animate(0, target, {
      duration,
      ease: "easeOut",
      onUpdate: (next) => setValue(next),
    });
    return () => controls.stop();
  }, [target, duration, reduce]);

  return value;
}

function statusText(status: string) {
  if (status === "running") return "Auditing";
  if (status === "finalizing") return "Analysing findings";
  if (status === "done") return "Audit complete";
  return "Audit failed";
}
