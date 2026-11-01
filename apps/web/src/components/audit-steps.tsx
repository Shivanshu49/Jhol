"use client";

import { useState } from "react";
import { rupees, type Run } from "@/lib/types";

/** Small evidence viewer that the report redesign can place wherever it needs. */
export function AuditSteps({ runs }: { runs: Run[] }) {
  const [selected, setSelected] = useState<Record<string, number>>({});
  if (!runs.some((run) => run.steps?.length)) return null;
  return (
    <section aria-label="Checkout evidence" className="space-y-4">
      <h2 className="text-sm font-bold uppercase tracking-widest text-white/70">Checkout evidence</h2>
      {runs.filter((run) => run.steps?.length).map((run) => {
        const step = run.steps.find((s) => s.idx === selected[run.id]) ?? run.steps.at(-1)!;
        return (
          <details key={run.id} open className="rounded-2xl border border-ink/10 bg-white p-4 text-ink">
            <summary className="cursor-pointer font-mono text-sm font-bold">Visit {run.session} · {run.steps.length} recorded steps</summary>
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <figure className="min-w-0">
                {step.screenshot_url ? (
                  <a href={step.screenshot_url} target="_blank" rel="noreferrer" aria-label={`Open visit ${run.session} step ${step.idx} screenshot`}>
                    {/* Public Storage URLs vary by deployment; use the image directly. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={step.screenshot_url} alt={`Visit ${run.session}, step ${step.idx}: ${step.page}`} className="aspect-[8/5] w-full border border-ink/10 object-contain" />
                  </a>
                ) : <p className="border border-dashed border-ink/15 p-8 text-sm text-ink/60">Screenshot unavailable for this step.</p>}
                <figcaption className="mt-2 flex justify-between gap-3 font-mono text-xs text-ink/65">
                  <span>Step {step.idx} · {step.page}</span>
                  {step.total_shown !== null && <span>{rupees(step.total_shown)}</span>}
                </figcaption>
              </figure>
              <ol aria-label={`Visit ${run.session} steps`} className="max-h-96 space-y-1 overflow-y-auto text-sm">
                {run.steps.map((s) => (
                  <li key={s.idx}>
                    <button type="button" aria-pressed={s.idx === step.idx} onClick={() => setSelected((prev) => ({ ...prev, [run.id]: s.idx }))}
                      className={`w-full border-l-2 px-3 py-2 text-left ${s.idx === step.idx ? "border-bluepen bg-bluepen/5" : "border-transparent hover:bg-ink/5"}`}>
                      <span className="font-mono text-xs text-ink/50">{s.idx}. {s.page}</span>
                      <span className="block break-words font-semibold">{s.action}</span>
                      {s.reason && <span className="block text-xs text-ink/65">{s.reason}</span>}
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </details>
        );
      })}
    </section>
  );
}
