import { Controller, Get, Header } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { AvailabilityService } from '../availability/availability.service';
import { MobilityView } from '../store/mobility-store';

interface PointFeatureCollection {
  type: 'FeatureCollection';
  features: { type: 'Feature'; geometry: { type: 'Point'; coordinates: [number, number] }; properties: { formFactor: string; count: number } }[];
}

/** All points as GeoJSON for the playground map. Only form factor and count are exposed. */
@ApiTags('map')
@Controller('v1/points')
export class PointsController {
  /** Built once per snapshot: ~20k features are too many to rebuild on every request. */
  private cache = new WeakMap<MobilityView, PointFeatureCollection>();

  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  @SkipThrottle({ batch: true })
  @Header('Cache-Control', 'public, max-age=30')
  @ApiOperation({ summary: 'All vehicle locations as a GeoJSON FeatureCollection (for the map)' })
  @ApiOkResponse({ description: 'GeoJSON FeatureCollection; properties: formFactor, count' })
  all(): PointFeatureCollection {
    const view = this.availability.currentView();
    let collection = this.cache.get(view);
    if (!collection) {
      collection = {
        type: 'FeatureCollection',
        features: Object.values(view.snapshot.providers).flatMap(({ points }) =>
          points.map((p) => ({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] as [number, number] },
            properties: { formFactor: p.formFactor, count: p.count },
          })),
        ),
      };
      this.cache.set(view, collection);
    }
    return collection;
  }
}
