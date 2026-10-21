import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";

export function safeEqual(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Dashboard → API calls are server-to-server (Next.js server actions / route handlers),
 * so a shared secret header is enough for now. Swap for Supabase Auth JWTs when orgs land.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const given = req.header("x-api-key") ?? "";
    if (!safeEqual(given, this.config.getOrThrow<string>("JHOL_API_KEY"))) {
      throw new UnauthorizedException("Missing or wrong x-api-key");
    }
    return true;
  }
}
