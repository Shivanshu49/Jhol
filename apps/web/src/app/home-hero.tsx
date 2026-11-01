"use client";

import { motion, type Variants } from "framer-motion";
import Link from "next/link";
import { LiveWindow } from "./live-window";

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: "easeOut" } },
};

const proof = [
  { value: "13", label: "CCPA patterns checked" },
  { value: "2", label: "visits per audit" },
  { value: "SHA-256", label: "sealed evidence" },
];

export function HomeHero() {
  return (
    <section className="relative isolate">
      <div className="jhol-grid absolute inset-x-0 -top-10 -z-10 h-[440px]" aria-hidden />
      <div className="absolute -right-20 -top-28 -z-10 h-80 w-80 rounded-full bg-primary/10 blur-3xl" aria-hidden />
      <div className="absolute -left-24 top-40 -z-10 h-64 w-64 rounded-full bg-secondary/20 blur-3xl" aria-hidden />

      <div className="grid items-center gap-10 lg:grid-cols-[1.02fr_1.12fr] lg:gap-12">
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="max-w-xl"
        >
          <motion.h1
            variants={item}
            className="mt-5 text-[2.5rem] font-black leading-[1.03] tracking-tight sm:text-5xl lg:text-[3.4rem]"
          >
            Find the{" "}
            <span className="relative inline-block text-primary">
              jhol
              <motion.span
                className="absolute -bottom-1.5 left-0 h-1.5 w-full origin-left rounded-full bg-primary/30"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ delay: 0.55, duration: 0.6, ease: "easeOut" }}
                aria-hidden
              />
            </span>{" "}
            in your checkout, <span className="text-white/55">before CCPA does.</span>
          </motion.h1>

          <motion.p variants={item} className="mt-5 max-w-lg text-base leading-relaxed text-white/75 sm:text-lg">
            An AI agent shops your site like a real customer, stops before payment, and reports every hidden fee,
            sneaked add-on and fake timer against CCPA&apos;s 13 dark patterns — with the exact text as proof.
          </motion.p>

          <motion.div variants={item} className="mt-7 flex flex-wrap items-center gap-3">
            <motion.a
              href="#audit"
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition-colors hover:bg-primary-hover"
            >
              Run a free audit
              <span aria-hidden>↘</span>
            </motion.a>
            <Link
              href="/lab/chalak-mart.html"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-white/70 px-4 py-3 text-sm font-semibold text-ink/70 transition-colors hover:border-secondary/40 hover:bg-secondary/10 hover:text-ink"
            >
              Open the test store <span aria-hidden>↗</span>
            </Link>
          </motion.div>

          <motion.p variants={item} className="mt-3 text-xs text-white/60">
            No signup · never pays · stops before payment
          </motion.p>

          <motion.dl variants={item} className="mt-8 grid max-w-md grid-cols-3 gap-2">
            {proof.map((p) => (
              <div key={p.label} className="rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 backdrop-blur-sm">
                <dt className="text-sm font-black leading-none">{p.value}</dt>
                <dd className="mt-1 text-[10px] font-medium uppercase tracking-wider text-white/60">{p.label}</dd>
              </div>
            ))}
          </motion.dl>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 26, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.15, ease: "easeOut" }}
          className="relative"
        >
          <LiveWindow />
        </motion.div>
      </div>
    </section>
  );
}
