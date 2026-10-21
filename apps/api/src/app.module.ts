import { type DynamicModule, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { BullModule } from "@nestjs/bullmq";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuditsController } from "./audits/audits.controller";
import { AuditsProcessor } from "./audits/audits.processor";
import { AuditsService } from "./audits/audits.service";
import { JudgeService } from "./audits/judge.service";
import { DbService } from "./common/db.service";
import { AUDIT_QUEUE } from "./common/queue";
import { redisConnection } from "./common/redis";
import type { Role } from "./common/role";
import { HealthController } from "./health.controller";
import { WebhooksController } from "./webhooks/webhooks.controller";

@Module({})
export class AppModule {
  static forRole(role: Role): DynamicModule {
    const serveHttp = role !== "worker";
    const runJobs = role !== "api";

    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: [".env", "../../.env"] }),
        BullModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            connection: redisConnection(config.getOrThrow<string>("REDIS_URL")),
          }),
        }),
        BullModule.registerQueue({ name: AUDIT_QUEUE }),
        ...(serveHttp ? [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])] : []),
      ],
      controllers: serveHttp ? [HealthController, AuditsController, WebhooksController] : [],
      providers: [
        DbService,
        AuditsService,
        ...(runJobs ? [AuditsProcessor, JudgeService] : []),
        ...(serveHttp ? [{ provide: APP_GUARD, useClass: ThrottlerGuard }] : []),
      ],
    };
  }
}
