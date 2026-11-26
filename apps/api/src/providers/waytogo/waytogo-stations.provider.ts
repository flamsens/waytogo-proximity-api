import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import { MobilityProvider, ProviderResult } from '../mobility-provider';
import { fetchJson } from './fetch-json';
import { normalizeStation } from './normalize';
import { parseFeed } from './parse-feed';
import { stationFeatureSchema } from './waytogo.schemas';

/** Station-based sharing (car-sharing stations and bike docks) from `GET /api/stations`. */
@Injectable()
export class WaytogoStationsProvider implements MobilityProvider {
  readonly id = 'waytogo-stations';

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async fetchPoints(signal: AbortSignal): Promise<ProviderResult> {
    const raw = await fetchJson(`${this.config.upstreamBaseUrl}/api/stations`, this.config.upstreamTimeoutMs, signal);
    const { items, featureCount, skipped } = parseFeed(raw, stationFeatureSchema);
    const now = new Date();
    return { points: items.flatMap((f) => normalizeStation(f, now)), featureCount, skipped };
  }
}
