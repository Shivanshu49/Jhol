import Link from "next/link";
import { AuditForm } from "./audit-form";

type Line = { label: string; amount: string; note?: string };

const BILL: Line[] = [
  { label: "Cotton crew tee  x1", amount: "499.00" },
  { label: "Green India donation", amount: "10.00", note: "never added this" },
  { label: "Order protection", amount: "49.00", note: "came pre-ticked" },
  { label: "Platform fee", amount: "19.00", note: "only shown at the last step" },
  { label: "Handling fee", amount: "29.00", note: "this one too" },
];

const CATCHES = [
  ["Hidden fees", "Charges that first appear at the last step"],
  ["Sneaked add-ons", "Donations or insurance put in the cart for you"],
  ["Fake timers", "A countdown that restarts on every visit"],
  ["Pre-ticked subscriptions", "A free trial that quietly renews"],
  ["Guilt-trip buttons", "No thanks, I don't mind if it arrives broken"],
  ["Nagging popups", "The same offer on every page"],
];

export default function Home() {
  return (
    <div>
      {/* Hero: the bill, marked up */}
      <section className="grid items-center gap-12 pb-20 pt-6 lg:grid-cols-[1fr_1.05fr] lg:gap-6">
        <div className="min-w-0 max-w-xl">
          <h1 className="display text-[clamp(2.9rem,8.5vw,6.8rem)]">
            ₹499 on the product page. ₹606 at payment.
          </h1>
          <p className="mt-6 text-xl leading-relaxed text-ink/80">
            Jhol shops your store like a real customer, marks every hidden charge and pre-ticked add-on with proof,
            and has Codex fix the checkout.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-6">
            <Link
              href="#try"
              className="rounded-md bg-bluepen px-6 py-3.5 text-lg font-semibold text-white hover:bg-bluepen/90"
            >
              Audit a store
            </Link>
            <Link href="#how" className="font-semibold underline decoration-2 underline-offset-4">
              See how it works
            </Link>
          </div>
        </div>

        <MarkedBill />
      </section>

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
      <section id="try" className="scroll-mt-8 border-t-2 border-ink pt-16">
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
    </div>
  );
}

function MarkedBill() {
  return (
    <div className="relative mx-auto w-full min-w-0 max-w-[420px] lg:mr-48">
      <p className="pen-note font-hand absolute -top-9 left-2 text-xl text-redpen" style={{ ["--d" as string]: "0.2s" }}>
        price on the product page: ₹499
      </p>
      <div className="receipt -rotate-1 px-7 pb-12 pt-10 text-[14px] leading-7">
        <p className="text-center font-semibold tracking-wide">CHALAK MART</p>
        <p className="text-center text-ink/60">Order CM-20481 · Guest checkout</p>
        <p className="my-3 overflow-hidden whitespace-nowrap text-ink/40">{"-".repeat(60)}</p>

        {BILL.map((l, i) => (
          <div key={l.label} className="relative">
            <div className="flex items-baseline">
              <span className="truncate">{l.label}</span>
              <span className="leader" />
              <span className="relative tabular-nums">
                {l.amount}
                {l.note && (
                  <svg className="pen-ring" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
                    <path
                      d="M8 22 C 6 8, 45 2, 80 6 C 98 9, 99 30, 70 35 C 40 39, 4 36, 6 20 C 7 14, 14 11, 22 9"
                      style={{ ["--d" as string]: `${0.5 + i * 0.45}s` }}
                    />
                  </svg>
                )}
              </span>
            </div>
            {l.note && (
              <span
                className="pen-note font-hand block text-[17px] leading-5 text-redpen lg:absolute lg:left-full lg:top-0 lg:ml-9 lg:whitespace-nowrap"
                style={{ ["--d" as string]: `${0.8 + i * 0.45}s` }}
              >
                {l.note}
              </span>
            )}
          </div>
        ))}

        <p className="my-3 overflow-hidden whitespace-nowrap text-ink/40">{"-".repeat(60)}</p>
        <div className="flex items-baseline text-lg font-semibold">
          <span>TOTAL</span>
          <span className="leader" />
          <span className="tabular-nums">₹606.00</span>
        </div>
      </div>

      <div
        className="stamp absolute -bottom-6 right-2 border-[3px] border-double border-redpen px-3 py-1 text-center font-mono font-semibold text-redpen sm:-right-6"
        style={{ ["--d" as string]: "2.9s" }}
      >
        <span className="block text-2xl leading-tight">+₹107</span>
        <span className="block text-xs">4 tricks found</span>
      </div>
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
