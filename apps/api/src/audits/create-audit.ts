import { BadRequestException } from "@nestjs/common";
import { isPublicUrl } from "@jhol/core";
import type { AuditOptions } from "../common/db.service";

export type CreateAuditInput = { url: string; sessions: 1 | 2; options: AuditOptions };

/**
 * ALLOW_PRIVATE_TARGETS=true lets audits open localhost / private networks (local dev: the test store on :5050).
 * Read in both the API (validation) and the worker (browser guard), so the two always agree.
 */
export const allowPrivateTargets = () => process.env.ALLOW_PRIVATE_TARGETS === "true";

/**
 * Validates POST /audits. The agent's browser runs inside our worker, so user URLs are an SSRF risk:
 * unless ALLOW_PRIVATE_TARGETS, the host must resolve only to public addresses (same check as the worker's guard proxy).
 */
export async function parseCreateAudit(body: unknown): Promise<CreateAuditInput> {
  const b = (body ?? {}) as Record<string, unknown>;

  let url: URL;
  try {
    url = new URL(String(b.url ?? "").trim());
  } catch {
    throw new BadRequestException("url must be a full URL, e.g. https://shop.example.com");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new BadRequestException("url must be http(s)");
  if (!allowPrivateTargets() && !(await isPublicUrl(url.toString()))) {
    throw new BadRequestException("url must be a public website");
  }

  const pincode = typeof b.pincode === "string" && /^\d{6}$/.test(b.pincode) ? b.pincode : undefined;

  return {
    url: url.toString(),
    sessions: b.sessions === 1 ? 1 : 2,
    options: pincode ? { pincode } : {},
  };
}
