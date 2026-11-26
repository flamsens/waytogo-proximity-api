import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { IngestService } from '../ingest/ingest.service';
import { MOBILITY_STORE, MobilityStore, MobilityView } from '../store/mobility-store';
import { aggregate } from './aggregate';
import { AvailabilityQueryDto, AvailabilityResultDto, DataInfoDto } from './availability.dto';

/** Answers proximity queries from the current data snapshot. */
@Injectable()
export class AvailabilityService {
  constructor(
    @Inject(MOBILITY_STORE) private readonly store: MobilityStore,
    private readonly ingest: IngestService,
  ) {}

  /**
   * The snapshot every query of one request uses. Without data from every source we answer
   * 503: zeros would look like "nothing here" when we simply don't know yet.
   */
  currentView(): MobilityView {
    const view = this.store.view();
    if (!view || !this.ingest.isReady()) throw new ServiceUnavailableException('data not loaded yet');
    return view;
  }

  async query(view: MobilityView, q: AvailabilityQueryDto): Promise<AvailabilityResultDto> {
    const carRadius = q.carRadius ?? q.radius;
    const matches = await view.findWithin({ lat: q.lat, lon: q.lon }, Math.max(q.radius, carRadius));
    return {
      query: { lat: q.lat, lon: q.lon, radiusMeters: q.radius, carRadiusMeters: carRadius },
      ...aggregate(matches, q.radius, carRadius),
    };
  }

  /** When each source was last fetched, and how old the oldest one is. */
  dataInfo(view: MobilityView, now = Date.now()): DataInfoDto {
    const sources = Object.fromEntries(
      Object.entries(view.snapshot.providers).map(([id, data]) => [id, data.status.fetchedAt]),
    );
    const oldest = Math.min(...Object.values(sources).map((t) => Date.parse(t)));
    return { sources, ageSeconds: Math.max(0, Math.floor((now - oldest) / 1000)) };
  }
}
