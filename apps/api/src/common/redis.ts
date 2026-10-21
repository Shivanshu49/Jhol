import type { ConnectionOptions } from "bullmq";

/** Turns REDIS_URL (redis:// or rediss://) into BullMQ connection options. */
export function redisConnection(redisUrl: string): ConnectionOptions {
  const u = new URL(redisUrl);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : undefined,
    tls: u.protocol === "rediss:" ? {} : undefined,
    family: 0, // resolve IPv4 and IPv6 — Railway's private network is IPv6
    maxRetriesPerRequest: null, // required by BullMQ workers
  };
}
