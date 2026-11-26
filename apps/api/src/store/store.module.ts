import { Module } from '@nestjs/common';
import { InMemoryMobilityStore } from './in-memory-mobility-store';
import { MOBILITY_STORE } from './mobility-store';

/** Binds {@link MOBILITY_STORE} to the in-memory implementation. A PostGIS store would be bound here. */
@Module({
  providers: [{ provide: MOBILITY_STORE, useClass: InMemoryMobilityStore }],
  exports: [MOBILITY_STORE],
})
export class StoreModule {}
