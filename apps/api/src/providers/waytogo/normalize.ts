import { MobilityPoint } from '../../domain/mobility';
import { StationFeature, VehicleFeature } from './waytogo.schemas';

/**
 * Upstream records are MongoDB documents; the first 8 hex chars of an ObjectId are the
 * unix time (seconds) it was written. That is our only per-record freshness signal.
 */
export function recordedAtFromObjectId(id: string | undefined, fallback: Date): string {
  if (!id || !/^[0-9a-f]{24}$/i.test(id)) return fallback.toISOString();
  return new Date(parseInt(id.slice(0, 8), 16) * 1000).toISOString();
}

/** A free-floating vehicle is always exactly one vehicle. */
export function normalizeVehicle(f: VehicleFeature, fallback: Date): MobilityPoint {
  const [lon, lat] = f.geometry.coordinates;
  return {
    lon,
    lat,
    operator: f.properties.operator,
    formFactor: f.properties.vehicleType.form_factor,
    count: 1,
    source: 'free_floating',
    recordedAt: recordedAtFromObjectId(f._id, fallback),
  };
}

/**
 * Turns one station into one point per listed vehicle type.
 *
 * Counting rules (see README "Data decisions"):
 * - `availability` (live free vehicles at docks) wins, else `capacity` (cars based at a station).
 * - Cambio lists each type once without per-type numbers; the station `capacity` is the total.
 *   Each type counts 1 and the remainder goes to the station's most common form factor
 *   (first entry of that form factor), so the station total stays exact.
 * - Entries that end up at 0 (empty docks) are dropped.
 */
export function normalizeStation(f: StationFeature, fallback: Date): MobilityPoint[] {
  const p = f.properties;
  const entries = p.vehicles;
  if (entries.length === 0) return [];

  const hasPerTypeCounts = entries.some((e) => e.availability !== undefined || e.capacity !== undefined);
  const counts = hasPerTypeCounts
    ? entries.map((e) => e.availability ?? e.capacity ?? 0)
    : distributeStationTotal(entries.map((e) => e.vehicleType.form_factor), p.capacity ?? entries.length);

  const [lon, lat] = f.geometry.coordinates;
  const recordedAt = recordedAtFromObjectId(f._id, fallback);
  return entries
    .map((e, i): MobilityPoint => ({
      lon,
      lat,
      operator: p.operator,
      formFactor: e.vehicleType.form_factor,
      count: counts[i],
      source: 'station',
      stationId: p.station_id,
      stationName: p.name,
      recordedAt,
    }))
    .filter((point) => point.count > 0);
}

/** Spreads a station total over its listed types: 1 each, remainder to the most common form factor. */
function distributeStationTotal(formFactors: string[], total: number): number[] {
  const counts = formFactors.map(() => 1);
  const remainder = total - formFactors.length;
  if (remainder > 0) {
    const frequency = new Map<string, number>();
    for (const ff of formFactors) frequency.set(ff, (frequency.get(ff) ?? 0) + 1);
    // Ties go to the form factor that appears first, because Map keeps insertion order.
    const [mostCommon] = [...frequency.entries()].reduce((best, cur) => (cur[1] > best[1] ? cur : best));
    counts[formFactors.indexOf(mostCommon)] += remainder;
  }
  return counts;
}
