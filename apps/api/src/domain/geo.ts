/** A WGS84 coordinate in decimal degrees. */
export interface GeoPoint {
  lat: number;
  lon: number;
}

/** Axis-aligned lon/lat rectangle, used to pre-filter the spatial index. */
export interface BoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/** Mean Earth radius (IUGG), in metres. */
export const EARTH_RADIUS_METERS = 6371008.8;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/**
 * Great-circle distance between two points (haversine formula).
 * Accurate to ~0.5 % at the ≤ 1 km scale we use, far below GPS noise.
 */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A lon/lat box that fully contains the circle around `center`.
 * It is padded by 0.1 % so rounding never excludes a point on the edge;
 * callers still apply the exact {@link haversineMeters} check afterwards.
 */
export function boundingBox(center: GeoPoint, radiusMeters: number): BoundingBox {
  const r = radiusMeters * 1.001;
  const dLat = toDeg(r / EARTH_RADIUS_METERS);
  const minLat = Math.max(-90, center.lat - dLat);
  const maxLat = Math.min(90, center.lat + dLat);
  // Use the latitude furthest from the equator: there a degree of longitude is shortest.
  const cosLat = Math.cos(toRad(Math.max(Math.abs(minLat), Math.abs(maxLat))));
  const dLon = cosLat < 1e-9 ? 360 : toDeg(r / (EARTH_RADIUS_METERS * cosLat));
  if (dLon >= 180) return { minLon: -180, minLat, maxLon: 180, maxLat };
  return { minLon: Math.max(-180, center.lon - dLon), minLat, maxLon: Math.min(180, center.lon + dLon), maxLat };
}
