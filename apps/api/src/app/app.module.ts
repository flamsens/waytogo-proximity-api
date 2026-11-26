import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AvailabilityModule } from '../availability/availability.module';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ConfigModule } from '../config/config.module';
import { IngestModule } from '../ingest/ingest.module';

@Module({
  imports: [
    ConfigModule,
    // Two named per-IP limits; each route skips the one that doesn't apply to it.
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        throttlers: [
          { name: 'default', ttl: 60_000, limit: config.rateLimitPerMinute },
          { name: 'batch', ttl: 60_000, limit: config.batchRateLimitPerMinute },
        ],
      }),
    }),
    IngestModule,
    AvailabilityModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
