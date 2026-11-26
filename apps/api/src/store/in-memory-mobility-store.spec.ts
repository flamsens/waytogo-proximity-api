import { GeoPoint, haversineMeters } from '../domain/geo';
import { MobilityPoint, Snapshot } from '../domain/mobility';
import { InMemoryMobilityStore } from './in-memory-mobility-store';

const center: GeoPoint = { lat: 51.0545, lon: 3.7215 };
const metersNorth = (m: number): GeoPoint => ({ lat: center.lat + (m / 6371008.8) * (180 / Math.PI), lon: center.lon });
const point = (p: GeoPoint, extra: Partial<MobilityPoint> = {}): MobilityPoint => ({
  ...p, operator: 'op', formFactor: 'bicycle', count: 1, source: 'free_floating', recordedAt: '2026-11-26T08:00:00Z', ...extra,
});
const snapshot = (points: MobilityPoint[]): Snapshot => ({
  builtAt: '2026-11-26T08:00:00Z',
  providers: { test: { points, status: { fetchedAt: '2026-11-26T08:00:00Z', lastAttemptAt: '2026-11-26T08:00:00Z', featureCount: points.length, skipped: 0 } } },
});

describe('InMemoryMobilityStore', () => {
  it('has no view before the first snapshot', () => {
    expect(new InMemoryMobilityStore().view()).toBeNull();
  });

  it('finds points inside the radius only', async () => {
    const store = new InMemoryMobilityStore();
    store.replace(snapshot([point(metersNorth(999), { stationId: 'in' }), point(metersNorth(1001), { stationId: 'out' })]));
    const found = await store.view()!.findWithin(center, 1000);
    expect(found.map((m) => m.point.stationId)).toEqual(['in']);
    expect(found[0].distanceMeters).toBeCloseTo(999, 0);
  });

  it('finds a point exactly at the centre with radius 1', async () => {
    const store = new InMemoryMobilityStore();
    store.replace(snapshot([point(center)]));
    expect(await store.view()!.findWithin(center, 1)).toHaveLength(1);
  });

  it('keeps an existing view stable after replace', async () => {
    const store = new InMemoryMobilityStore();
    store.replace(snapshot([point(center)]));
    const old = store.view()!;
    store.replace(snapshot([]));
    expect(await old.findWithin(center, 10)).toHaveLength(1);
    expect(await store.view()!.findWithin(center, 10)).toHaveLength(0);
  });

  it('matches a brute-force search', async () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const points = Array.from({ length: 5000 }, () => point({ lat: 50.7 + rand() * 0.8, lon: 3.5 + rand() * 1.2 }));
    const store = new InMemoryMobilityStore();
    store.replace(snapshot(points));
    const view = store.view()!;
    for (let q = 0; q < 50; q++) {
      const c = { lat: 50.7 + rand() * 0.8, lon: 3.5 + rand() * 1.2 };
      const r = 1 + rand() * 999;
      const expected = points.filter((p) => haversineMeters(c, p) <= r).length;
      expect((await view.findWithin(c, r)).length).toBe(expected);
    }
  });
});
