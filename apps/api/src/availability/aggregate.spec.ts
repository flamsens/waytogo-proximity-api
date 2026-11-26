import { MobilityPoint } from '../domain/mobility';
import { PointMatch } from '../store/mobility-store';
import { aggregate } from './aggregate';

const m = (formFactor: string, count: number, distanceMeters: number): PointMatch => ({
  point: { lat: 0, lon: 0, operator: 'op', formFactor, count, source: 'station', recordedAt: '' } as MobilityPoint,
  distanceMeters,
});
const matches = [m('bicycle', 2, 150), m('bicycle', 1, 300), m('car', 3, 300), m('scooter', 1, 50)];

describe('aggregate', () => {
  it('returns zeros for all known form factors', () => {
    expect(aggregate([], 500, 500)).toEqual({ total: 0, byFormFactor: { car: 0, bicycle: 0, cargo_bicycle: 0, scooter: 0 } });
  });
  it('uses carRadius for cars only (larger car radius)', () => {
    expect(aggregate(matches, 200, 400)).toEqual({ total: 6, byFormFactor: { car: 3, bicycle: 2, cargo_bicycle: 0, scooter: 1 } });
  });
  it('uses carRadius for cars only (smaller car radius)', () => {
    expect(aggregate(matches, 400, 200)).toEqual({ total: 4, byFormFactor: { car: 0, bicycle: 3, cargo_bicycle: 0, scooter: 1 } });
  });
  it('passes unknown form factors through', () => {
    expect(aggregate([m('moped', 2, 10)], 100, 100).byFormFactor.moped).toBe(2);
  });
  it('exposes nothing but total and byFormFactor', () => {
    expect(Object.keys(aggregate(matches, 500, 500)).sort()).toEqual(['byFormFactor', 'total']);
  });
});
