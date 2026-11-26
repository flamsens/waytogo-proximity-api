import vehicles from './__fixtures__/waytogo-vehicles.sample.json';
import stations from './__fixtures__/waytogo-stations.sample.json';
import { normalizeStation, normalizeVehicle, recordedAtFromObjectId } from './normalize';
import { stationFeatureSchema, vehicleFeatureSchema, StationFeature } from './waytogo.schemas';

const fallback = new Date('2026-11-26T08:00:00Z');
const station = (id: string): StationFeature =>
  stationFeatureSchema.parse(stations.find((s) => s.properties.station_id === id));
const counts = (id: string) => normalizeStation(station(id), fallback).map((p) => p.count);

describe('normalizeVehicle', () => {
  it('maps a free-floating vehicle to one point', () => {
    const p = normalizeVehicle(vehicleFeatureSchema.parse(vehicles[0]), fallback);
    expect(p).toMatchObject({ formFactor: 'scooter', count: 1, source: 'free_floating', operator: 'lime', lon: 4.390966, lat: 51.213369 });
    expect(p).not.toHaveProperty('propulsion');
    expect(p.recordedAt).toBe(new Date(parseInt('6a85da10', 16) * 1000).toISOString());
  });
  it('rejects a feature with invalid coordinates', () => {
    expect(vehicleFeatureSchema.safeParse(vehicles[3]).success).toBe(false);
  });
});

describe('recordedAtFromObjectId', () => {
  it('falls back when the id is not an ObjectId', () => {
    expect(recordedAtFromObjectId('nothex', fallback)).toBe(fallback.toISOString());
    expect(recordedAtFromObjectId(undefined, fallback)).toBe(fallback.toISOString());
  });
});

describe('normalizeStation', () => {
  it('uses live availability at docks', () => expect(counts('villo-1')).toEqual([7, 5]));
  it('uses capacity at car-sharing stations', () => expect(counts('degage-1')).toEqual([2]));
  it('prefers availability over capacity', () => expect(counts('wibee-1')).toEqual([1]));
  it('cambio: one per listed type when capacity matches', () => expect(counts('cambio-pupillen')).toEqual([1, 1, 1]));
  it('cambio: remainder to the most common form factor', () => expect(counts('cambio-astrid')).toEqual([2, 1, 1]));
  it('cambio: without capacity, one per listed type', () => expect(counts('cambio-nocap')).toEqual([1, 1]));
  it('accepts a missing propulsion type', () => {
    expect(normalizeStation(station('cozy-bike'), fallback)).toEqual([expect.objectContaining({ formFactor: 'bicycle', count: 1, source: 'station' })]);
  });
  it('accepts a null propulsion type (cozywheels)', () => expect(counts('cozy-cargo')).toEqual([1]));
  it('drops empty docks', () => expect(counts('villo-empty')).toEqual([]));
  it('handles stations without vehicles', () => expect(counts('no-vehicles')).toEqual([]));
  it('rejects null coordinates', () => {
    const bad = { ...stations[0], geometry: { type: 'Point', coordinates: [null, 51] } };
    expect(stationFeatureSchema.safeParse(bad).success).toBe(false);
  });
});
