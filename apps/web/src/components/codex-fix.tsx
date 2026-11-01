"use client";

import { useState } from "react";
import Link from "next/link";
import { rupees, type AuditView } from "@/lib/types";

export const FIX_ACTIVE = new Set(["queued", "fixing", "pr_opened", "rechecking"]);

export function CodexFix({ view, onQueued }: { view: AuditView; onQueued: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { audit, fix_after: after } = view;
  const status = audit.fix_status;
  const active = status ? FIX_ACTIVE.has(status) : false;
  if (!view.fix_available && !status) return null;

  async function fix() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/audits/${encodeURIComponent(audit.id)}/fix`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.message === "string" ? data.message : `Could not start fix (${res.status})`);
      onQueued();
    } catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  }

  const label = status === "rechecking" ? "Re-checking…"
    : status === "pr_opened" ? "PR opened · Re-checking…"
    : pending || active ? "Fixing…"
    : status === "done" ? "Fix checked by Jhol" : status === "failed" ? "Retry with Codex" : "Fix with Codex";

  return (
    <section aria-label="Codex fix" className="space-y-4 border-t-2 border-dashed border-white/15 pt-6">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void fix()} disabled={pending || active || status === "done" || !view.fix_available}
          className="rounded-lg border-2 border-bluepen bg-bluepen px-5 py-3 font-bold text-white transition hover:opacity-85 disabled:cursor-default disabled:opacity-60">
          {label}
        </button>
        <span role="status" aria-live="polite" className="text-sm text-white/75">
          {status === "queued" && "Your fix is queued."}
          {status === "fixing" && "Codex is removing the captured dark patterns."}
          {status === "rechecking" && "Jhol is shopping the fixed store again."}
        </span>
        {audit.fix_pr_url && <a href={audit.fix_pr_url} target="_blank" rel="noreferrer" className="font-bold text-white underline underline-offset-4">PR opened ↗</a>}
      </div>
      {(error || audit.fix_error) && <p role="alert" className="text-sm text-redpen">{error || audit.fix_error}</p>}
      {audit.fix_branch && !audit.fix_pr_url && <p className="break-all text-sm text-white/65">Local fix branch: <code>{audit.fix_branch}</code></p>}
      {after && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Receipt label="Before" price={audit.price_final} score={audit.score} />
          <Receipt label="After" price={after.price_final} score={after.score} checked={status === "done"} />
          <Link href={`/audits/${after.id}`} className="text-sm font-bold text-white underline underline-offset-4 sm:col-span-2">Read the re-audit receipt →</Link>
        </div>
      )}
      {audit.fix_diff_summary && !audit.fix_pr_url && <pre className="overflow-auto border-l-2 border-white/30 pl-3 text-xs text-white/65">{audit.fix_diff_summary}</pre>}
    </section>
  );
}

function Receipt({ label, price, score, checked = false }: { label: string; price: number | null; score: number | null; checked?: boolean }) {
  return (
    <div className="relative space-y-2 rounded-2xl border border-dashed border-ink/25 bg-white p-5 font-mono text-ink">
      <p className="text-xs font-bold uppercase tracking-[.2em] text-ink/55">{label}</p>
      <p className="text-3xl font-black">{price === null ? "Checking…" : rupees(price)}</p>
      <p className="border-t border-dashed border-ink/20 pt-2 text-sm">Jhol score <strong>{score === null ? "…" : `${score}/100`}</strong></p>
      {checked && <p className="inline-block -rotate-3 border-2 border-bluepen px-2 py-1 text-xs font-black tracking-widest text-bluepen">CHECKED BY JHOL</p>}
    </div>
  );
}
