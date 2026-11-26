import { boundingBox, haversineMeters, GeoPoint } from './geo';

/** Moves a point `meters` towards a bearing (0 = north, 90 = east). */
function move(p: GeoPoint, meters: number, bearingDeg: number): GeoPoint {
  const R = 6371008.8;
  const d = meters / R;
  const b = (bearingDeg * Math.PI) / 180;
  const lat1 = (p.lat * Math.PI) / 180;
  const lon1 = (p.lon * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI };
}

describe('haversineMeters', () => {
  it('measures Gent-Sint-Pieters to Korenmarkt (~2.2 km)', () => {
    const d = haversineMeters({ lat: 51.0359, lon: 3.7108 }, { lat: 51.0545, lon: 3.7215 });
    expect(d).toBeGreaterThan(2180);
    expect(d).toBeLessThan(2220);
  });
  it('is 0 for the same point', () => {
    expect(haversineMeters({ lat: 51, lon: 4 }, { lat: 51, lon: 4 })).toBe(0);
  });
});

describe('boundingBox', () => {
  it('contains the circle', () => {
    const c = { lat: 51, lon: 4 };
    const bb = boundingBox(c, 1000);
    for (const bearing of [0, 90, 180, 270]) {
      const p = move(c, 1000, bearing);
      expect(haversineMeters(c, p)).toBeLessThanOrEqual(1000.5);
      expect(p.lat).toBeGreaterThanOrEqual(bb.minLat);
      expect(p.lat).toBeLessThanOrEqual(bb.maxLat);
      expect(p.lon).toBeGreaterThanOrEqual(bb.minLon);
      expect(p.lon).toBeLessThanOrEqual(bb.maxLon);
    }
  });
  it('spans all longitudes near the pole', () => {
    const bb = boundingBox({ lat: 89.999, lon: 0 }, 1000);
    expect(bb.minLon).toBe(-180);
    expect(bb.maxLon).toBe(180);
  });
});
