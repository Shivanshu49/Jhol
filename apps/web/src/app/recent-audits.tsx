"use client";

import { motion, type Variants } from "framer-motion";
import Link from "next/link";
import { rupees, type Audit } from "@/lib/types";

const STATUS: Record<Audit["status"], { label: string; badge: string; dot: string }> = {
  running: { label: "Running", badge: "bg-primary/10 text-primary", dot: "bg-primary" },
  finalizing: { label: "Finalizing", badge: "bg-secondary/10 text-secondary", dot: "bg-secondary" },
  done: { label: "Done", badge: "bg-secondary text-white", dot: "bg-secondary" },
  failed: { label: "Failed", badge: "bg-accent/10 text-accent", dot: "bg-accent" },
};

const listVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055 } },
};

const rowVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

export function RecentAudits({ audits }: { audits: Audit[] }) {
  if (audits.length === 0) return null;

  return (
    <section className="mx-auto w-full max-w-4xl">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Track record</p>
          <h2 className="mt-0.5 text-2xl font-black">Recent audits</h2>
        </div>
        <span className="text-[11px] font-medium text-white/60">{audits.length} total</span>
      </div>

      <motion.ul
        variants={listVariants}
        initial="hidden"
        animate="show"
        className="divide-y divide-ink/10 overflow-hidden rounded-2xl border border-ink/10 bg-white text-ink shadow-sm"
      >
        {audits.map((audit) => {
          const status = STATUS[audit.status];
          const running = audit.status === "running" || audit.status === "finalizing";

          return (
            <motion.li key={audit.id} variants={rowVariants}>
              <Link
                href={`/audits/${audit.id}`}
                className="group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-secondary/5"
              >
                <span className="relative flex h-2 w-2 shrink-0">
                  {running && (
                    <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${status.dot}`} />
                  )}
                  <span className={`relative inline-flex h-2 w-2 rounded-full ${status.dot}`} aria-hidden />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{prettyUrl(audit.url)}</p>
                  <p className="mt-0.5 text-[11px] text-ink/45">
                    {formatDate(audit.created_at)} · {audit.sessions === 2 ? "2 visits" : "1 visit"}
                    {running && <span className="ml-1.5 font-semibold text-primary">· live</span>}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  {audit.status === "done" ? (
                    <>
                      <p className="text-sm font-black leading-none">
                        {audit.score ?? "–"}
                        <span className="text-[10px] font-medium text-ink/40">/100</span>
                      </p>
                      {audit.price_shown !== null && audit.price_final !== null && (
                        <p className="mt-1 hidden text-[10px] text-ink/45 sm:block">
                          {rupees(audit.price_shown)} → {rupees(audit.price_final)}
                        </p>
                      )}
                    </>
                  ) : (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${status.badge}`}>
                      {status.label}
                    </span>
                  )}
                </div>

                <span
                  className="text-ink/25 transition-all group-hover:translate-x-0.5 group-hover:text-ink/50"
                  aria-hidden
                >
                  →
                </span>
              </Link>
            </motion.li>
          );
        })}
      </motion.ul>
    </section>
  );
}

function prettyUrl(value: string) {
  try {
    const url = new URL(value);
    const path = url.pathname === "/" ? "" : url.pathname;
    return `${url.hostname.replace(/^www\./, "")}${path}`;
  } catch {
    return value;
  }
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}
