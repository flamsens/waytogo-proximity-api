import { Injectable } from '@nestjs/common';
import KDBush from 'kdbush';
import { boundingBox, GeoPoint, haversineMeters } from '../domain/geo';
import { MobilityPoint, Snapshot } from '../domain/mobility';
import { MobilityStore, MobilityView, PointMatch } from './mobility-store';

/**
 * Keeps all points in memory in a static KD-tree (KDBush) on lon/lat.
 * ~20k points take a few ms to index and a query takes well under a millisecond:
 * a bounding-box range query, then an exact haversine filter.
 */
@Injectable()
export class InMemoryMobilityStore implements MobilityStore {
  private current: MobilityView | null = null;

  replace(snapshot: Snapshot): void {
    const points: MobilityPoint[] = Object.values(snapshot.providers).flatMap((p) => p.points);
    // KDBush can't be built without points; an empty snapshot simply matches nothing.
    const index = points.length > 0 ? new KDBush(points.length) : null;
    if (index) {
      for (const p of points) index.add(p.lon, p.lat);
      index.finish();
    }

    // Build the new view completely, then swap it in with one assignment:
    // concurrent requests never see a half-built index.
    this.current = Object.freeze({
      snapshot,
      async findWithin(center: GeoPoint, radiusMeters: number): Promise<PointMatch[]> {
        if (!index) return [];
        const bb = boundingBox(center, radiusMeters);
        const matches: PointMatch[] = [];
        for (const i of index.range(bb.minLon, bb.minLat, bb.maxLon, bb.maxLat)) {
          const distanceMeters = haversineMeters(center, points[i]);
          if (distanceMeters <= radiusMeters) matches.push({ point: points[i], distanceMeters });
        }
        return matches;
      },
    });
  }

  view(): MobilityView | null {
    return this.current;
  }
}
