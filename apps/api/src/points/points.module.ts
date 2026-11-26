import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module';
import { PointsController } from './points.controller';

@Module({ imports: [AvailabilityModule], controllers: [PointsController] })
export class PointsModule {}
