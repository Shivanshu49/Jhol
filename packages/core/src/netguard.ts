/**
 * Keeps the agent's browser off internal networks (SSRF): loopback, private ranges, cloud metadata, etc.
 * The browser is pointed at a local forward proxy that resolves each host once, refuses internal addresses and
 * connects to the exact IP it checked, so redirects, popups, subresources, websockets and DNS rebinding are covered.
 */
import { lookup } from "node:dns/promises";
import { createServer, request as httpRequest } from "node:http";
import { BlockList, connect, isIP, type AddressInfo } from "node:net";

// Loopback, private, link-local (cloud metadata), CGNAT, multicast/reserved, and their IPv6 equivalents.
// Node checks IPv4-mapped IPv6 (::ffff:127.0.0.1) against the IPv4 rules itself.
const INTERNAL = new BlockList();
for (const [net, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16], ["224.0.0.0", 3]] as const) {
  INTERNAL.addSubnet(net, bits, "ipv4");
}
for (const [net, bits] of [["::", 127], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["64:ff9b::", 96]] as const) {
  INTERNAL.addSubnet(net, bits, "ipv6");
}

/** The address to connect to if every address the host resolves to is public, else null. */
async function publicAddress(host: string): Promise<string | null> {
  const h = host.replace(/^\[|\]$/g, "");
  try {
    const addrs = isIP(h) ? [{ address: h, family: isIP(h) }] : await lookup(h, { all: true, verbatim: true });
    const ok = addrs.length > 0 && addrs.every((a) => !INTERNAL.check(a.address, a.family === 6 ? "ipv6" : "ipv4"));
    return ok ? (addrs.find((a) => a.family === 4) ?? addrs[0]).address : null; // IPv4 first: many hosts lack an IPv6 route
  } catch {
    return null;
  }
}

/** True only for http(s)/ws(s) URLs whose host resolves exclusively to public addresses. */
export async function isPublicUrl(raw: string): Promise<boolean> {
  if (!URL.canParse(raw)) return false;
  const u = new URL(raw);
  return /^(https?|wss?):$/.test(u.protocol) && (await publicAddress(u.hostname)) !== null;
}

/** Start the guard proxy on a random loopback port. Pass `server` to chromium.launch({ proxy: { server } }). */
export async function startGuardProxy(): Promise<{ server: string; close: () => void }> {
  const proxy = createServer(async (req, res) => {
    // plain http:// — the browser sends the absolute URL
    req.on("error", () => res.destroy());
    const u = URL.canParse(req.url ?? "") ? new URL(req.url ?? "") : null;
    const ip = u?.protocol === "http:" ? await publicAddress(u.hostname) : null;
    if (!u || !ip) return void res.writeHead(403).end("Blocked by Jhol: internal address");
    const headers = { ...req.headers };
    delete headers["proxy-connection"];
    delete headers["proxy-authorization"];
    const up = httpRequest({ host: ip, port: u.port || 80, path: u.pathname + u.search, method: req.method, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", () => (res.headersSent ? res.destroy() : res.writeHead(502).end()));
    req.pipe(up);
  });

  proxy.on("connect", async (req, client, head) => {
    // https:// and ws(s):// — CONNECT host:port, then a raw tunnel to the checked IP
    client.on("error", () => client.destroy());
    const target = req.url ?? "";
    const colon = target.lastIndexOf(":");
    const port = Number(target.slice(colon + 1));
    const ip = colon > 0 && port > 0 ? await publicAddress(target.slice(0, colon)) : null;
    if (!ip) return void client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    const up = connect(port, ip, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      up.write(head);
      up.pipe(client);
      client.pipe(up);
    });
    up.on("error", () => client.destroy());
    client.on("close", () => up.destroy());
  });

  await new Promise<void>((ok) => proxy.listen(0, "127.0.0.1", ok));
  const { port } = proxy.address() as AddressInfo;
  return { server: `http://127.0.0.1:${port}`, close: () => proxy.close() };
}
