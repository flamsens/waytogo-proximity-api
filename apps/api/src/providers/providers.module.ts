import { Module } from '@nestjs/common';
import { MOBILITY_PROVIDERS, MobilityProvider } from './mobility-provider';
import { WaytogoStationsProvider } from './waytogo/waytogo-stations.provider';
import { WaytogoVehiclesProvider } from './waytogo/waytogo-vehicles.provider';

/**
 * Registers the active data sources. To switch or add a source, add its class here
 * and to the `inject` list.
 */
@Module({
  providers: [
    WaytogoVehiclesProvider,
    WaytogoStationsProvider,
    {
      provide: MOBILITY_PROVIDERS,
      useFactory: (...providers: MobilityProvider[]) => providers,
      inject: [WaytogoVehiclesProvider, WaytogoStationsProvider],
    },
  ],
  exports: [MOBILITY_PROVIDERS],
})
export class ProvidersModule {}
