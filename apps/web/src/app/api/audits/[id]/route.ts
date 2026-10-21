import { backend } from "@/lib/backend";

export const dynamic = "force-dynamic";

/** Browser polls this; it forwards to the Jhol API with the server-side key. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const res = await backend(`/audits/${encodeURIComponent(id)}`);
    return new Response(await res.text(), {
      status: res.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (err) {
    return Response.json({ message: (err as Error).message }, { status: 502 });
  }
}
