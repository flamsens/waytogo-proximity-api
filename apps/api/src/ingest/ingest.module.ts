import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ProvidersModule } from '../providers/providers.module';
import { StoreModule } from '../store/store.module';
import { IngestService } from './ingest.service';

/** Pulls the providers on an interval and publishes the data to the store. */
@Module({
  imports: [ScheduleModule.forRoot(), ProvidersModule, StoreModule],
  providers: [IngestService],
  exports: [IngestService, StoreModule],
})
export class IngestModule {}
