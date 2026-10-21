import { Controller, Get } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";

@Controller("health")
@SkipThrottle()
export class HealthController {
  @Get()
  health() {
    return { ok: true, service: "jhol-api", time: new Date().toISOString() };
  }
}
