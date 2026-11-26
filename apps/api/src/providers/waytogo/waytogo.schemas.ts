import { z } from 'zod';

/**
 * Zod schemas for the (undocumented) waytogo map endpoints.
 * Only the fields we use are validated; unknown keys are allowed so harmless
 * upstream additions don't break ingestion.
 */

const coordinatesSchema = z.tuple([
  z.number().finite().min(-180).max(180), // lon
  z.number().finite().min(-90).max(90), // lat
]);

const pointGeometrySchema = z.looseObject({ type: z.literal('Point'), coordinates: coordinatesSchema });

const vehicleTypeSchema = z.looseObject({
  form_factor: z.string().min(1),
  // Propulsion is validated loosely but not used: the API deliberately doesn't expose it.
  propulsion_type: z.string().optional(),
});

/** One free-floating vehicle from `GET /api/vehicles`. */
export const vehicleFeatureSchema = z.looseObject({
  _id: z.string().optional(),
  geometry: pointGeometrySchema,
  properties: z.looseObject({
    vehicleType: vehicleTypeSchema,
    operator: z.string().min(1),
  }),
});

/** One station from `GET /api/stations`, with the vehicle types based or docked there. */
export const stationFeatureSchema = z.looseObject({
  _id: z.string().optional(),
  geometry: pointGeometrySchema,
  properties: z.looseObject({
    station_id: z.coerce.string(),
    name: z.string().optional(),
    operator: z.string().min(1),
    capacity: z.number().nonnegative().optional(),
    vehicles: z
      .array(
        z.looseObject({
          vehicleType: vehicleTypeSchema,
          capacity: z.number().nonnegative().optional(),
          availability: z.number().nonnegative().optional(),
        }),
      )
      .default([]),
  }),
});

export type VehicleFeature = z.infer<typeof vehicleFeatureSchema>;
export type StationFeature = z.infer<typeof stationFeatureSchema>;
