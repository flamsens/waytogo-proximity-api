import { GeoPoint } from '../domain/geo';
import { MobilityPoint, Snapshot } from '../domain/mobility';

/** A point found by a proximity search, with its distance to the search centre. */
export interface PointMatch {
  point: MobilityPoint;
  distanceMeters: number;
}

/**
 * An immutable, queryable version of the data. A `replace()` on the store after a view
 * was taken doesn't change that view, so all queries of one request (e.g. a batch) see the
 * same snapshot. Async so a database-backed store (e.g. PostGIS) can implement it too.
 */
export interface MobilityView {
  readonly snapshot: Snapshot;
  /** All points within `radiusMeters` (great-circle) of `center`. */
  findWithin(center: GeoPoint, radiusMeters: number): Promise<PointMatch[]>;
}

/** Holds the current data. Swap the implementation (e.g. PostGIS) without changing the API. */
export interface MobilityStore {
  replace(snapshot: Snapshot): void;
  /** `null` until the first snapshot was loaded. */
  view(): MobilityView | null;
}

/** DI token for the active {@link MobilityStore}. */
export const MOBILITY_STORE = Symbol('MOBILITY_STORE');
