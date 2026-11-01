"use client";

import { useActionState, useRef } from "react";
import { createAudit, type FormState } from "./actions";

export function AuditForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createAudit, {});
  const urlRef = useRef<HTMLInputElement>(null);

  return (
    <form action={action} className="space-y-4 rounded-md bg-receipt p-6">
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
          className="w-full rounded-md border-2 border-ink/20 px-4 py-3 text-base outline-none focus:border-bluepen"
        />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 whitespace-nowrap rounded-md bg-bluepen px-6 py-3 font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Starting…" : "Run audit"}
        </button>
      </div>

      <button
        type="button"
        onClick={() => {
          if (urlRef.current) urlRef.current.value = `${window.location.origin}/lab/chalak-mart.html`;
        }}
        className="text-sm font-semibold text-bluepen underline underline-offset-4"
      >
        Use the Chalak Mart test store
      </button>
      <p className="text-xs text-ink/50">The site must be public. Jhol never pays and never uses real personal data.</p>

      <label className="flex gap-2 text-sm">
        <input type="checkbox" name="urgencyTest" defaultChecked /> Fake-timer test (visits a second time after 2 min)
      </label>

      <input
        name="pincode"
        inputMode="numeric"
        pattern="\d{6}"
        placeholder="Delivery pincode (optional)"
        className="w-60 rounded-md border-2 border-ink/20 px-3 py-2 text-sm outline-none focus:border-bluepen"
      />

      {state.error && <p className="text-sm font-medium text-red-700">{state.error}</p>}
    </form>
  );
}
