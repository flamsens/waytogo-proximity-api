import vehicles from './__fixtures__/waytogo-vehicles.sample.json';
import stations from './__fixtures__/waytogo-stations.sample.json';
import { loadConfig } from '../../config/app-config';
import { WaytogoVehiclesProvider } from './waytogo-vehicles.provider';
import { WaytogoStationsProvider } from './waytogo-stations.provider';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('waytogo providers', () => {
  const fetchMock = jest.spyOn(global, 'fetch');
  afterEach(() => fetchMock.mockReset());
  const signal = () => new AbortController().signal;

  it('fetches and normalizes vehicles', async () => {
    fetchMock.mockImplementation(() => json(vehicles));
    const provider = new WaytogoVehiclesProvider(loadConfig({}));
    const result = await provider.fetchPoints(signal());
    expect(provider.id).toBe('waytogo-vehicles');
    expect(fetchMock.mock.calls[0][0]).toBe('https://map.waytogo.be/api/vehicles');
    expect(result).toMatchObject({ featureCount: 4, skipped: 1 });
    expect(result.points).toHaveLength(3);
  });

  it('fetches and normalizes stations', async () => {
    fetchMock.mockImplementation(() => json(stations));
    const provider = new WaytogoStationsProvider(loadConfig({}));
    const result = await provider.fetchPoints(signal());
    expect(provider.id).toBe('waytogo-stations');
    expect(fetchMock.mock.calls[0][0]).toBe('https://map.waytogo.be/api/stations');
    expect(result.points.reduce((s, p) => s + p.count, 0)).toBe(7 + 5 + 2 + 1 + 3 + 4 + 2 + 1);
  });

  it('rejects on HTTP errors', async () => {
    fetchMock.mockImplementation(() => json({ error: 'boom' }, 500));
    await expect(new WaytogoVehiclesProvider(loadConfig({})).fetchPoints(signal())).rejects.toThrow(/500/);
  });

  it('times out a hanging upstream', async () => {
    fetchMock.mockImplementation((_url, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
    );
    const provider = new WaytogoVehiclesProvider(loadConfig({ UPSTREAM_TIMEOUT_MS: '50' }));
    const started = Date.now();
    await expect(provider.fetchPoints(signal())).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
