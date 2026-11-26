import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import { MobilityProvider, ProviderResult } from '../mobility-provider';
import { fetchJson } from './fetch-json';
import { normalizeVehicle } from './normalize';
import { parseFeed } from './parse-feed';
import { vehicleFeatureSchema } from './waytogo.schemas';

/** Free-floating vehicles (bikes, scooters, cars) from `GET /api/vehicles`. */
@Injectable()
export class WaytogoVehiclesProvider implements MobilityProvider {
  readonly id = 'waytogo-vehicles';

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async fetchPoints(signal: AbortSignal): Promise<ProviderResult> {
    const raw = await fetchJson(`${this.config.upstreamBaseUrl}/api/vehicles`, this.config.upstreamTimeoutMs, signal);
    const { items, featureCount, skipped } = parseFeed(raw, vehicleFeatureSchema);
    const now = new Date();
    return { points: items.map((f) => normalizeVehicle(f, now)), featureCount, skipped };
  }
}
