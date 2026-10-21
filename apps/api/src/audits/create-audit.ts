import { BadRequestException } from "@nestjs/common";
import type { AuditOptions } from "../common/db.service";

export type CreateAuditInput = { url: string; sessions: 1 | 2; options: AuditOptions };

const PRIVATE_HOST = /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/i;

/** Validates POST /audits. Only public http(s) sites; TinyFish's browser has to reach them. */
export function parseCreateAudit(body: unknown): CreateAuditInput {
  const b = (body ?? {}) as Record<string, unknown>;

  let url: URL;
  try {
    url = new URL(String(b.url ?? "").trim());
  } catch {
    throw new BadRequestException("url must be a full URL, e.g. https://shop.example.com");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new BadRequestException("url must be http(s)");
  if (PRIVATE_HOST.test(url.hostname)) throw new BadRequestException("url must be a public website");

  const pincode = typeof b.pincode === "string" && /^\d{6}$/.test(b.pincode) ? b.pincode : undefined;

  return {
    url: url.toString(),
    sessions: b.sessions === 1 ? 1 : 2,
    options: { stealth: b.stealth === true, indiaProxy: b.indiaProxy === true, ...(pincode ? { pincode } : {}) },
  };
}
