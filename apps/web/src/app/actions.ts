"use server";

import { redirect } from "next/navigation";
import { backend, errorMessage } from "@/lib/backend";

export type FormState = { error?: string };

export async function createAudit(_prev: FormState, formData: FormData): Promise<FormState> {
  const pincode = String(formData.get("pincode") ?? "").trim();
  const body = {
    url: String(formData.get("url") ?? "").trim(),
    sessions: formData.get("urgencyTest") === "on" ? 2 : 1,
    indiaProxy: formData.get("indiaProxy") === "on",
    stealth: formData.get("stealth") === "on",
    ...(pincode ? { pincode } : {}),
  };

  let id: string;
  try {
    const res = await backend("/audits", { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) return { error: await errorMessage(res) };
    id = ((await res.json()) as { id: string }).id;
  } catch (err) {
    return { error: (err as Error).message };
  }
  redirect(`/audits/${id}`);
}
