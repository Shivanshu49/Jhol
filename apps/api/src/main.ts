import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { allowPrivateTargets } from "./audits/create-audit";
import { readRole } from "./common/role";

/**
 * One codebase, three ways to run it:
 *   ROLE=api     → HTTP only (Railway service #1)
 *   ROLE=worker  → BullMQ jobs only (Railway service #2)
 *   ROLE=all     → both in one process (local dev, default)
 */
async function bootstrap() {
  const role = readRole();
  const log = new Logger("Bootstrap");
  const warnPrivate = () => {
    // checked after Nest has loaded .env
    if (process.env.NODE_ENV === "production" && allowPrivateTargets()) {
      log.warn("!!! ALLOW_PRIVATE_TARGETS=true in production: audits can reach localhost and private networks (SSRF). Local dev only. !!!");
    }
  };

  if (role === "worker") {
    const app = await NestFactory.createApplicationContext(AppModule.forRole(role));
    app.enableShutdownHooks();
    warnPrivate();
    log.log("Worker running: processing audit jobs");
    return;
  }

  const app = await NestFactory.create(AppModule.forRole(role));
  app.enableShutdownHooks();
  warnPrivate();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, "0.0.0.0");
  log.log(`API (ROLE=${role}) listening on :${port}`);
}

void bootstrap();
