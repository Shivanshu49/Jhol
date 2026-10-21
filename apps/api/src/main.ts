import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
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

  if (role === "worker") {
    const app = await NestFactory.createApplicationContext(AppModule.forRole(role));
    app.enableShutdownHooks();
    log.log("Worker running: processing audit jobs");
    return;
  }

  const app = await NestFactory.create(AppModule.forRole(role));
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, "0.0.0.0");
  log.log(`API (ROLE=${role}) listening on :${port}`);
}

void bootstrap();
