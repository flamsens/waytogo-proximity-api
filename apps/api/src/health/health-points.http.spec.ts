import request from 'supertest';
import { createTestApp, FakeProvider, fakePoint } from '../testing/test-app';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

describe('GET /health', () => {
  it('is unavailable until every source has data', async () => {
    const { app } = await createTestApp([new FakeProvider('a', [fakePoint(51, 4, 'car')]), new FakeProvider('slow', null)]);
    const res = await request(app.getHttpServer()).get('/health').expect(503);
    expect(res.body.status).toBe('unavailable');
    await app.close();
  });

  it('is ok with fresh data and lists stale operators without degrading', async () => {
    const { app } = await createTestApp(
      [
        new FakeProvider('a', [fakePoint(51, 4, 'scooter', 1, { operator: 'lime', recordedAt: hoursAgo(48) })]),
        new FakeProvider('b', [fakePoint(51, 4, 'car', 1, { operator: 'cambio' })]),
      ],
    );
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(Object.keys(res.body.sources).sort()).toEqual(['a', 'b']);
    expect(res.body.staleOperators).toEqual(['lime']);
    await app.close();
  });

  it('is degraded when a source keeps failing', async () => {
    const failing = new FakeProvider('b', [fakePoint(51, 4, 'car')]);
    const { app, ingest } = await createTestApp([new FakeProvider('a', [fakePoint(51, 4, 'car')]), failing]);
    failing.error = new Error('upstream down');
    await ingest.runOnce();
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.sources.b.lastError).toBe('upstream down');
    await app.close();
  });
});

describe('GET /v1/points', () => {
  it('returns all points as GeoJSON with only formFactor and count', async () => {
    const { app } = await createTestApp([
      new FakeProvider('a', [fakePoint(51, 4, 'car', 2), fakePoint(51.1, 4.1, 'bicycle')]),
      // Enough points to exceed compression's 1 KB threshold.
      new FakeProvider('b', Array.from({ length: 50 }, (_, i) => fakePoint(51.2, 4.2 + i / 1000, 'scooter'))),
    ]);
    const res = await request(app.getHttpServer()).get('/v1/points').set('Accept-Encoding', 'gzip').expect(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.body.type).toBe('FeatureCollection');
    expect(res.body.features).toHaveLength(52);
    for (const f of res.body.features) expect(Object.keys(f.properties).sort()).toEqual(['count', 'formFactor']);
    expect(res.body.features[0]).toEqual({ type: 'Feature', geometry: { type: 'Point', coordinates: [4, 51] }, properties: { formFactor: 'car', count: 2 } });
    await app.close();
  });
});
