"use client";

import { useActionState, useRef } from "react";
import { createAudit, type FormState } from "./actions";

export function AuditForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createAudit, {});
  const urlRef = useRef<HTMLInputElement>(null);

  return (
    <form action={action} className="space-y-4 rounded-2xl border border-ink/10 bg-white p-5 shadow-sm">
      <label htmlFor="url" className="block text-sm font-semibold">
        Website to audit
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          ref={urlRef}
          id="url"
          name="url"
          type="url"
          required
          placeholder="https://shop.example.com"
          className="w-full rounded-xl border border-ink/15 px-4 py-3 text-base outline-none focus:border-brand"
        />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 whitespace-nowrap rounded-xl bg-ink px-6 py-3 font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Starting…" : "Run audit"}
        </button>
      </div>

      <button
        type="button"
        onClick={() => {
          if (urlRef.current) urlRef.current.value = `${window.location.origin}/lab/chalak-mart.html`;
        }}
        className="text-sm text-brand underline underline-offset-4"
      >
        Use the Chalak Mart test store
      </button>
      <p className="text-xs text-ink/50">
        The agent runs in TinyFish&apos;s cloud browser, so the site must be public. The test store works once this app is
        deployed.
      </p>

      <fieldset className="grid gap-2 text-sm sm:grid-cols-3">
        <label className="flex gap-2">
          <input type="checkbox" name="urgencyTest" defaultChecked /> False-urgency test (second visit after 2 min)
        </label>
        <label className="flex gap-2">
          <input type="checkbox" name="indiaProxy" /> Browse from an Indian IP
        </label>
        <label className="flex gap-2">
          <input type="checkbox" name="stealth" /> Stealth browser for bot-protected sites
        </label>
      </fieldset>

      <input
        name="pincode"
        inputMode="numeric"
        pattern="\d{6}"
        placeholder="Delivery pincode (optional)"
        className="w-60 rounded-xl border border-ink/15 px-3 py-2 text-sm outline-none focus:border-brand"
      />

      {state.error && <p className="text-sm font-medium text-red-700">{state.error}</p>}
    </form>
  );
}
