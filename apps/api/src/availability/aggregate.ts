import { KNOWN_FORM_FACTORS } from '../domain/mobility';
import { PointMatch } from '../store/mobility-store';

/** Vehicle counts around one location. Operator and propulsion are deliberately not exposed. */
export interface AvailabilityCounts {
  total: number;
  /** Always contains the known form factors (0 when none); new upstream values appear too. */
  byFormFactor: Record<string, number>;
}

/**
 * Sums vehicle counts per form factor. Cars count when within `carRadiusMeters`, everything
 * else when within `radiusMeters` (you walk further for a car). Callers must have searched
 * with at least `max(radiusMeters, carRadiusMeters)`.
 */
export function aggregate(matches: PointMatch[], radiusMeters: number, carRadiusMeters: number): AvailabilityCounts {
  const byFormFactor: Record<string, number> = Object.fromEntries(KNOWN_FORM_FACTORS.map((ff) => [ff, 0]));
  let total = 0;
  for (const { point, distanceMeters } of matches) {
    const limit = point.formFactor === 'car' ? carRadiusMeters : radiusMeters;
    if (distanceMeters > limit) continue;
    byFormFactor[point.formFactor] = (byFormFactor[point.formFactor] ?? 0) + point.count;
    total += point.count;
  }
  return { total, byFormFactor };
}
