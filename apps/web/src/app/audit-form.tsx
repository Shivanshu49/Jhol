"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useActionState, useRef, useState } from "react";
import { createAudit, type FormState } from "./actions";

const CHIPS = [
  { name: "urgencyTest", label: "False-urgency test", detail: "Visit twice, 2 min apart" },
] as const;

type ChipName = (typeof CHIPS)[number]["name"];

export function AuditForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createAudit, {});
  const urlRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [pincodeOpen, setPincodeOpen] = useState(false);
  const [on, setOn] = useState<Record<ChipName, boolean>>({
    urgencyTest: true,
  });

  function toggle(name: ChipName) {
    setOn((prev) => ({ ...prev, [name]: !prev[name] }));
  }

  function fillTestStore() {
    setUrl(`${window.location.origin}/lab/chalak-mart.html`);
    urlRef.current?.focus();
  }

  return (
    <form
      action={action}
      className="relative overflow-hidden rounded-3xl border border-ink/10 bg-white p-4 text-ink shadow-xl shadow-black/10 sm:p-6"
    >
      {pending && (
        <motion.div
          className="absolute inset-x-0 top-0 h-0.5 bg-primary"
          style={{ originX: 0 }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: [0, 1] }}
          transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
          aria-hidden
        />
      )}

      {CHIPS.map((chip) => (
        <input key={chip.name} type="hidden" name={chip.name} value={on[chip.name] ? "on" : "off"} />
      ))}

      <label htmlFor="url" className="sr-only">
        Website to audit
      </label>

      <div className="flex flex-col gap-2.5 sm:flex-row">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl border border-ink/15 bg-paper/40 px-3.5 transition-colors focus-within:border-primary/50 focus-within:bg-white focus-within:ring-4 focus-within:ring-primary/10">
          <GlobeIcon />
          <input
            ref={urlRef}
            id="url"
            name="url"
            type="url"
            required
            autoComplete="url"
            inputMode="url"
            spellCheck={false}
            disabled={pending}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://shop.example.com/checkout"
            className="min-w-0 flex-1 bg-transparent py-3.5 text-sm outline-none placeholder:text-ink/35 disabled:opacity-60 sm:text-base"
          />
        </div>

        <motion.button
          type="submit"
          disabled={pending}
          whileHover={pending ? undefined : { y: -1 }}
          whileTap={pending ? undefined : { scale: 0.98 }}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />
          ) : (
            <span aria-hidden>→</span>
          )}
          <span aria-live="polite">{pending ? "Starting…" : "Run audit"}</span>
        </motion.button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {CHIPS.map((chip) => {
          const active = on[chip.name];
          return (
            <motion.button
              key={chip.name}
              type="button"
              onClick={() => toggle(chip.name)}
              aria-pressed={active}
              title={chip.detail}
              whileTap={{ scale: 0.97 }}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                active
                  ? "border-primary/25 bg-secondary/25 text-ink"
                  : "border-ink/15 bg-white text-ink/50 hover:border-ink/30 hover:text-ink/75"
              }`}
            >
              <span
                className={`grid h-3.5 w-3.5 place-items-center rounded-full border transition-colors ${
                  active ? "border-primary bg-primary text-white" : "border-ink/25 text-transparent"
                }`}
              >
                <motion.svg
                  viewBox="0 0 10 10"
                  className="h-2 w-2"
                  fill="none"
                  animate={{ scale: active ? 1 : 0.5, opacity: active ? 1 : 0 }}
                  transition={{ duration: 0.15 }}
                  aria-hidden
                >
                  <path d="M1.5 5.2 3.8 7.5 8.5 2.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </motion.svg>
              </span>
              {chip.label}
            </motion.button>
          );
        })}

        <span className="mx-1 hidden h-4 w-px bg-accent/10 sm:block" aria-hidden />

        <button
          type="button"
          onClick={() => setPincodeOpen((v) => !v)}
          aria-expanded={pincodeOpen}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-[11px] font-semibold text-ink/45 transition-colors hover:bg-secondary/10 hover:text-secondary"
        >
          <span className={`text-sm leading-none transition-transform ${pincodeOpen ? "rotate-45" : ""}`} aria-hidden>
            +
          </span>
          Delivery pincode
        </button>
      </div>

      <AnimatePresence initial={false}>
        {pincodeOpen && (
          <motion.div
            key="pincode"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="pt-3">
              <label htmlFor="pincode" className="mb-1.5 block text-[11px] font-semibold text-ink/50">
                Delivery pincode (optional)
              </label>
              <input
                id="pincode"
                name="pincode"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                disabled={pending}
                placeholder="560001"
                className="w-40 rounded-xl border border-ink/15 bg-paper/40 px-3 py-2 text-sm outline-none transition-colors focus:border-primary/50 focus:bg-white focus:ring-4 focus:ring-primary/10 disabled:opacity-60"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink/45">
        <button
          type="button"
          onClick={fillTestStore}
          disabled={pending}
          className="font-semibold text-primary underline decoration-primary/30 underline-offset-4 transition-colors hover:text-primary-hover hover:decoration-primary-hover disabled:opacity-60"
        >
          Use the Chalak Mart test store
        </button>
        <span>Cloud browser · never pays · stops before payment</span>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-ink/40">
        OpenAI&apos;s cloud browser can&apos;t open localhost, so audit a public URL or deploy this app to use the test
        store.
      </p>
      <p className="mt-2 text-[11px] leading-relaxed text-ink/40">
        Jhol never pays and never uses real personal data.
      </p>

      <AnimatePresence initial={false}>
        {state.error && (
          <motion.p
            key={state.error}
            initial={{ opacity: 0, height: 0, y: -4 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            role="alert"
            className="mt-3 overflow-hidden rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-sm font-medium text-primary"
          >
            {state.error}
          </motion.p>
        )}
      </AnimatePresence>
    </form>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-ink/35" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3 10h14M10 3c1.8 2 2.7 4.3 2.7 7S11.8 15 10 17c-1.8-2-2.7-4.3-2.7-7S8.2 5 10 3Z" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
