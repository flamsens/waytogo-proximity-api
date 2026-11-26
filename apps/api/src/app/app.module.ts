import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AvailabilityModule } from '../availability/availability.module';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ConfigModule } from '../config/config.module';
import { HealthModule } from '../health/health.module';
import { IngestModule } from '../ingest/ingest.module';
import { PointsModule } from '../points/points.module';

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
    PointsModule,
    HealthModule,
    // Playground map (static files copied to dist by the Nx build).
    ServeStaticModule.forRoot({ rootPath: join(__dirname, 'assets', 'map'), exclude: ['/v1/{*path}', '/health', '/docs{*path}'] }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
