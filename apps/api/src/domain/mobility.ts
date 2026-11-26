/** Vehicle kind, e.g. 'car', 'bicycle', 'cargo_bicycle', 'scooter' (new upstream values pass through). */
export type FormFactor = string;

/** Form factors that are always present in API responses, so clients get a stable shape. */
export const KNOWN_FORM_FACTORS = ['car', 'bicycle', 'cargo_bicycle', 'scooter'] as const;

/**
 * One location with `count` vehicles of a single form factor: a free-floating vehicle
 * (count 1) or one vehicle type at a station. This is the unit stored in the spatial index.
 */
export interface MobilityPoint {
  lon: number;
  lat: number;
  /** Internal only: used for /health freshness, never exposed in API output. */
  operator: string;
  formFactor: FormFactor;
  /** ≥ 1 */
  count: number;
  source: 'free_floating' | 'station';
  stationId?: string;
  stationName?: string;
  /** ISO time the upstream record was written (decoded from its Mongo `_id`). */
  recordedAt: string;
}

/** Health of one provider's most recent fetches. */
export interface SourceStatus {
  /** Last successful fetch. */
  fetchedAt: string;
  featureCount: number;
  skipped: number;
  lastAttemptAt: string;
  /** Set when the latest attempt failed; the previous points are still served. */
  lastError?: string;
}

/** The last good data of one provider. */
export interface ProviderData {
  points: MobilityPoint[];
  status: SourceStatus;
}

/** Last good data per provider (keyed by provider id); the index is built from all of them. */
export interface Snapshot {
  builtAt: string;
  providers: Record<string, ProviderData>;
}
