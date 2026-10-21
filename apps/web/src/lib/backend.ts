import "server-only";

/** Server-side call to the Jhol API. The shared key never reaches the browser. */
export async function backend(path: string, init: RequestInit = {}): Promise<Response> {
  const base = process.env.API_URL;
  const key = process.env.JHOL_API_KEY;
  if (!base || !key) throw new Error("Set API_URL and JHOL_API_KEY in apps/web/.env.local");

  return fetch(`${base.replace(/\/+$/, "")}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-api-key": key, ...(init.headers ?? {}) },
    cache: "no-store",
  });
}

/** Nest errors come back as { message: string | string[] }. */
export async function errorMessage(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { message?: string | string[] };
  const msg = Array.isArray(data.message) ? data.message.join(", ") : data.message;
  return msg ?? `API error ${res.status}`;
}
