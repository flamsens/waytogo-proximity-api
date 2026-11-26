import { MobilityPoint } from '../domain/mobility';

/** Result of one fetch of one provider. */
export interface ProviderResult {
  points: MobilityPoint[];
  /** Number of upstream records received. */
  featureCount: number;
  /** Records skipped because they failed validation. */
  skipped: number;
}

/**
 * A source of shared-mobility data. To change or add a data source, implement this
 * interface and register the class under {@link MOBILITY_PROVIDERS} in `ProvidersModule`.
 * Nothing outside the provider knows the upstream format.
 */
export interface MobilityProvider {
  /** Stable id, used as key in the snapshot and in /health (e.g. 'waytogo-vehicles'). */
  readonly id: string;
  fetchPoints(signal: AbortSignal): Promise<ProviderResult>;
}

/** DI token resolving to `MobilityProvider[]`. */
export const MOBILITY_PROVIDERS = Symbol('MOBILITY_PROVIDERS');

/** The upstream response no longer looks like what we expect (likely a format change). */
export class ProviderFormatError extends Error {
  override name = 'ProviderFormatError';
}
