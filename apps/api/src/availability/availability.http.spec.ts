import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, FakeProvider, fakePoint } from '../testing/test-app';

// Korenmarkt, Gent and points due north of it.
const C = { lat: 51.0545, lon: 3.7215 };
const north = (m: number) => C.lat + (m / 6371008.8) * (180 / Math.PI);
const points = [
  fakePoint(north(100), C.lon, 'bicycle', 2),
  fakePoint(north(300), C.lon, 'bicycle', 1),
  fakePoint(north(300), C.lon, 'car', 3),
  fakePoint(north(50), C.lon, 'scooter', 1),
];
const q = (extra: string) => `/v1/availability?lat=${C.lat}&lon=${C.lon}&${extra}`;

/** Recursively collects all object keys of a JSON value. */
const keysOf = (v: unknown): string[] =>
  v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : [];

describe('availability API', () => {
  let app: INestApplication;
  beforeAll(async () => {
    ({ app } = await createTestApp([new FakeProvider('a', points), new FakeProvider('b', [])]));
  });
  afterAll(() => app.close());

  it('counts vehicles per form factor', async () => {
    const res = await request(app.getHttpServer()).get(q('radius=500')).expect(200);
    expect(res.body).toMatchObject({
      query: { lat: C.lat, lon: C.lon, radiusMeters: 500, carRadiusMeters: 500 },
      total: 7,
      byFormFactor: { bicycle: 3, car: 3, cargo_bicycle: 0, scooter: 1 },
    });
    expect(Object.keys(res.body.data.sources).sort()).toEqual(['a', 'b']);
    expect(res.body.data.ageSeconds).toBeGreaterThanOrEqual(0);
    expect(res.headers['cache-control']).toBe('public, max-age=30');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('applies carRadius to cars only', async () => {
    let res = await request(app.getHttpServer()).get(q('radius=200&carRadius=400')).expect(200);
    expect(res.body.byFormFactor).toMatchObject({ car: 3, bicycle: 2 });
    res = await request(app.getHttpServer()).get(q('radius=400&carRadius=200')).expect(200);
    expect(res.body.byFormFactor).toMatchObject({ car: 0, bicycle: 3 });
  });

  it('accepts the radius bounds', async () => {
    await request(app.getHttpServer()).get(q('radius=1')).expect(200);
    await request(app.getHttpServer()).get(q('radius=1000&carRadius=1000')).expect(200);
  });

  it.each(['radius=0', 'radius=1000.01', 'radius=-5', 'radius=abc', 'radius=', '', 'radius=10&carRadius=0', 'radius=10&carRadius=1001'])(
    'rejects %p',
    async (params) => {
      const res = await request(app.getHttpServer()).get(q(params)).expect(400);
      expect(JSON.stringify(res.body.message)).toMatch(/radius/i);
    },
  );

  it.each([['lat=&lon=3.7&radius=10', 'lat'], ['lat=51&lon=%20&radius=10', 'lon']])('rejects blank coordinate %p', async (params, field) => {
    const res = await request(app.getHttpServer()).get(`/v1/availability?${params}`).expect(400);
    expect(JSON.stringify(res.body.message)).toMatch(new RegExp(field));
  });

  it('rejects non-numeric JSON values in a batch', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/availability/batch')
      .send({ points: [{ lat: '', lon: true, radius: 10 }] })
      .expect(400);
    expect(JSON.stringify(res.body.message)).toMatch(/points\.0\.lat/);
    expect(JSON.stringify(res.body.message)).toMatch(/points\.0\.lon/);
  });

  it('rejects coordinates out of range', async () => {
    const res = await request(app.getHttpServer()).get('/v1/availability?lat=91&lon=3&radius=10').expect(400);
    expect(JSON.stringify(res.body.message)).toMatch(/lat/);
    await request(app.getHttpServer()).get('/v1/availability?lat=51&lon=181&radius=10').expect(400);
  });

  it('returns zeros far away (North Sea)', async () => {
    const res = await request(app.getHttpServer()).get('/v1/availability?lat=51.6&lon=2.5&radius=1000').expect(200);
    expect(res.body).toMatchObject({ total: 0, byFormFactor: { car: 0, bicycle: 0, cargo_bicycle: 0, scooter: 0 } });
  });

  it('answers a batch in request order', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/availability/batch')
      .send({ points: [{ id: 'x', ...C, radius: 200, carRadius: 400 }, { id: 'sea', lat: 51.6, lon: 2.5, radius: 10 }] })
      .expect(200);
    expect(res.body.results.map((r: { id: string; total: number }) => [r.id, r.total])).toEqual([['x', 6], ['sea', 0]]);
    expect(res.body.data.sources).toBeDefined();
  });

  it.each([[[]], [Array.from({ length: 101 }, () => ({ ...C, radius: 10 }))]])('rejects a batch of %#', async (pts) => {
    await request(app.getHttpServer()).post('/v1/availability/batch').send({ points: pts }).expect(400);
  });

  it('names the invalid batch point', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/availability/batch')
      .send({ points: [{ ...C, radius: 10 }, { ...C, radius: 5000 }] })
      .expect(400);
    expect(JSON.stringify(res.body.message)).toMatch(/points\.1\.radius/);
  });

  it('never exposes operator or propulsion', async () => {
    const single = await request(app.getHttpServer()).get(q('radius=500'));
    const batch = await request(app.getHttpServer()).post('/v1/availability/batch').send({ points: [{ ...C, radius: 500 }] });
    for (const body of [single.body, batch.body]) {
      expect(keysOf(body)).not.toEqual(expect.arrayContaining(['operator']));
      expect(keysOf(body).filter((k) => /operator|propulsion/i.test(k))).toEqual([]);
    }
  });

  it('documents the API', async () => {
    const res = await request(app.getHttpServer()).get('/docs-json').expect(200);
    expect(Object.keys(res.body.paths)).toEqual(expect.arrayContaining(['/v1/availability', '/v1/availability/batch']));
  });
});

describe('availability API before data is loaded', () => {
  it('answers 503 instead of zeros', async () => {
    const { app } = await createTestApp([new FakeProvider('a', points), new FakeProvider('slow', null)]);
    const res = await request(app.getHttpServer()).get(q('radius=500')).expect(503);
    expect(res.body.message).toBe('data not loaded yet');
    await app.close();
  });
});

describe('rate limits', () => {
  it('limits single and batch requests separately', async () => {
    const { app } = await createTestApp([new FakeProvider('a', points)], { RATE_LIMIT_PER_MINUTE: '3', BATCH_RATE_LIMIT_PER_MINUTE: '2' });
    const server = app.getHttpServer();
    for (let i = 0; i < 3; i++) await request(server).get(q('radius=10')).expect(200);
    await request(server).get(q('radius=10')).expect(429);
    const batch = () => request(server).post('/v1/availability/batch').send({ points: [{ ...C, radius: 10 }] });
    await batch().expect(200);
    await batch().expect(200);
    await batch().expect(429);
    await app.close();
  });
});
