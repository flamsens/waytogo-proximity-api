import { Module } from '@nestjs/common';
import { IngestModule } from '../ingest/ingest.module';
import { HealthController } from './health.controller';

@Module({ imports: [IngestModule], controllers: [HealthController] })
export class HealthModule {}
