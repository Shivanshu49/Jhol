import { backend } from "@/lib/backend";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const res = await backend(`/audits/${encodeURIComponent(id)}/fix`, { method: "POST" });
    return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch {
    return Response.json({ message: "The audit service is unavailable. Try again shortly." }, { status: 502 });
  }
}
