import Link from "next/link";
import { backend } from "@/lib/backend";
import { rupees, type Audit } from "@/lib/types";
import { AuditForm } from "./audit-form";

export const dynamic = "force-dynamic";

async function recentAudits(): Promise<Audit[]> {
  try {
    const res = await backend("/audits");
    return res.ok ? ((await res.json()) as Audit[]) : [];
  } catch {
    return [];
  }
}

export default async function Home() {
  const audits = await recentAudits();

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">Dark-pattern audit</p>
        <h1 className="text-4xl font-black leading-tight sm:text-5xl">
          Find the jhol in your checkout, before CCPA does.
        </h1>
        <p className="max-w-2xl text-ink/70">
          An AI agent shops your site like a real customer, stops before payment, and reports every hidden fee, sneaked
          add-on and fake timer against CCPA&apos;s 13 dark patterns, with the exact text as proof.
        </p>
      </section>

      <AuditForm />

      {audits.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-widest text-ink/50">Recent audits</h2>
          <ul className="divide-y divide-ink/10 rounded-2xl border border-ink/10 bg-white">
            {audits.map((a) => (
              <li key={a.id}>
                <Link href={`/audits/${a.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-paper">
                  <span className="truncate text-sm">{a.url}</span>
                  <span className="shrink-0 text-sm text-ink/60">
                    {a.status === "done"
                      ? `${a.score ?? "–"}/100${a.price_shown && a.price_final ? ` · ${rupees(a.price_shown)} → ${rupees(a.price_final)}` : ""}`
                      : a.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
