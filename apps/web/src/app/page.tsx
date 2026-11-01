import Link from "next/link";
import { backend } from "@/lib/backend";
import type { Audit } from "@/lib/types";
import { AuditForm } from "./audit-form";
import { HomeHero } from "./home-hero";
import { RecentAudits } from "./recent-audits";

const CATCHES = [
  ["Hidden fees", "Charges that first appear at the last step"],
  ["Sneaked add-ons", "Donations or insurance put in the cart for you"],
  ["Fake timers", "A countdown that restarts on every visit"],
  ["Pre-ticked subscriptions", "A free trial that quietly renews"],
  ["Guilt-trip buttons", "No thanks, I don't mind if it arrives broken"],
  ["Nagging popups", "The same offer on every page"],
];

export const dynamic = "force-dynamic";

async function recentAudits(): Promise<Audit[]> {
  try {
    const response = await backend("/audits");
    return response.ok ? ((await response.json()) as Audit[]) : [];
  } catch {
    return [];
  }
}

export default async function Home() {
  const audits = await recentAudits();

  return (
    <div className="space-y-16 pb-12 sm:space-y-24">
      <HomeHero />

      {/* Problem, said plainly */}
      <section className="grid gap-8 border-t-2 border-ink py-16 lg:grid-cols-[1fr_1.4fr]">
        <h2 className="display text-5xl sm:text-6xl">Nobody checks the last step.</h2>
        <div className="max-w-2xl space-y-4 text-lg leading-relaxed">
          <p>
            These charges hide after the cart, so you only see them if you actually check out. India&apos;s consumer
            regulator, CCPA, has banned 13 of these tricks. A 2025 audit still found them on <b>97%</b> of the
            country&apos;s major shopping platforms, and shoppers lose an estimated <b>₹25,000 crore</b> a year.
          </p>
          <p className="text-ink/70">
            Stores are now being fined for it. Most of them never meant to break a rule; nobody had time to check
            every flow by hand.
          </p>
          <p className="text-sm text-ink/50">Sources: LocalCircles audit 2025, Datum Intelligence, CCPA Guidelines 2023.</p>
        </div>
      </section>

      {/* How it works: a real sequence */}
      <section id="how" className="scroll-mt-8 border-t-2 border-ink py-16">
        <h2 className="display text-5xl sm:text-6xl">What happens when you paste a link</h2>
        <ol className="mt-10 grid gap-10 md:grid-cols-3">
          <Step n="1" title="Jhol goes shopping">
            An AI agent opens your store, picks a product and walks through checkout as a guest. It stops at the
            payment page and never buys anything.
          </Step>
          <Step n="2" title="It marks the bill">
            Every price, fee, pre-ticked box and timer is recorded. Anything that breaks a CCPA rule is flagged with
            the exact text it saw.
          </Step>
          <Step n="3" title="Codex fixes it">
            One click and Codex edits the checkout code and opens a pull request. Jhol shops the fixed version again
            to confirm the problems are gone.
          </Step>
        </ol>
      </section>

      {/* What it catches: printed like a bill */}
      <section className="grid gap-10 border-t-2 border-ink py-16 lg:grid-cols-[1fr_1.4fr]">
        <h2 className="display text-5xl sm:text-6xl">What Jhol looks for</h2>
        <div className="receipt px-6 py-9 text-[15px] sm:px-9">
          {CATCHES.map(([name, eg]) => (
            <div key={name} className="py-2.5">
              <div className="flex items-baseline">
                <span className="font-semibold">{name}</span>
                <span className="leader" />
                <span className="font-hand text-lg text-redpen">✗</span>
              </div>
              <p className="text-ink/60">{eg}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Before / after */}
      <section className="border-t-2 border-ink py-16">
        <h2 className="display max-w-3xl text-5xl sm:text-6xl">Same order, after Codex&apos;s fix</h2>
        <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:max-w-4xl">
          <SmallBill
            caption="Before"
            total="606.00"
            lines={[["Cotton crew tee", "499.00"], ["Donation", "10.00"], ["Order protection", "49.00"], ["Platform fee", "19.00"], ["Handling fee", "29.00"]]}
            marked
          />
          <SmallBill
            caption="After the pull request"
            total="499.00"
            lines={[["Cotton crew tee", "499.00"], ["Donation (optional, unticked)", "0.00"], ["Delivery", "FREE"]]}
          />
        </div>
      </section>

      {/* Who it's for */}
      <section className="grid gap-8 border-t-2 border-ink py-16 md:grid-cols-2">
        <div className="max-w-md">
          <h3 className="display text-4xl">For stores</h3>
          <p className="mt-3 text-lg leading-relaxed text-ink/80">
            Find and fix these before a regulator does, and re-check automatically every time your checkout changes.
          </p>
        </div>
        <div className="max-w-md">
          <h3 className="display text-4xl">For shoppers</h3>
          <p className="mt-3 text-lg leading-relaxed text-ink/80">
            Check a store before you pay, and keep the evidence if you want to file a complaint.
          </p>
        </div>
      </section>

      {/* Try it */}
      <section id="audit" className="scroll-mt-24 border-t-2 border-ink pt-16">
        <h2 className="display text-5xl sm:text-6xl">Audit a store</h2>
        <p className="mt-3 max-w-xl text-lg text-ink/70">
          No store handy? Try Chalak Mart, our test shop with 9 tricks planted on purpose.{" "}
          <Link href="/lab/chalak-mart.html" className="font-semibold text-bluepen underline underline-offset-4">
            Open Chalak Mart
          </Link>
        </p>
        <div className="mt-8 max-w-3xl">
          <AuditForm />
        </div>
      </section>

      <RecentAudits audits={audits} />
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="font-hand text-5xl leading-none text-bluepen" aria-hidden="true">
        {n}
      </span>
      <div>
        <h3 className="text-xl font-bold">{title}</h3>
        <p className="mt-2 leading-relaxed text-ink/75">{children}</p>
      </div>
    </li>
  );
}

function SmallBill({ caption, lines, total, marked }: { caption: string; lines: [string, string][]; total: string; marked?: boolean }) {
  return (
    <figure>
      <figcaption className="mb-3 font-semibold">{caption}</figcaption>
      <div className="receipt relative px-6 pb-10 pt-8 text-[13px] leading-6">
        {lines.map(([label, amount], i) => (
          <div key={label} className="flex items-baseline">
            <span className={marked && i > 0 ? "text-redpen line-through decoration-2" : ""}>{label}</span>
            <span className="leader" />
            <span className={`tabular-nums ${marked && i > 0 ? "text-redpen line-through decoration-2" : ""}`}>{amount}</span>
          </div>
        ))}
        <div className="mt-3 flex items-baseline border-t border-dashed border-ink/30 pt-3 text-base font-semibold">
          <span>TOTAL</span>
          <span className="leader" />
          <span className="tabular-nums">₹{total}</span>
        </div>
        {!marked && (
          <span className="absolute -right-2 bottom-3 rotate-[-8deg] border-2 border-bluepen px-2 py-0.5 font-mono text-xs font-semibold text-bluepen">
            CHECKED BY JHOL
          </span>
        )}
      </div>
    </figure>
  );
}
