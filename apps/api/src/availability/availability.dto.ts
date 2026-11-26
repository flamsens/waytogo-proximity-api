import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

/** Query of `GET /v1/availability`; also one point of a batch. */
export class AvailabilityQueryDto {
  @ApiProperty({ example: 51.0545, minimum: -90, maximum: 90, description: 'Latitude (WGS84)' })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @ApiProperty({ example: 3.7215, minimum: -180, maximum: 180, description: 'Longitude (WGS84)' })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lon!: number;

  @ApiProperty({ example: 200, minimum: 1, maximum: 1000, description: 'Search radius in metres for all vehicles' })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1000)
  radius!: number;

  @ApiPropertyOptional({ example: 400, minimum: 1, maximum: 1000, description: 'Search radius in metres for cars only (defaults to radius)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1000)
  carRadius?: number;
}

/** One point of a batch request; `id` is echoed back so callers can match results. */
export class BatchPointDto extends AvailabilityQueryDto {
  @ApiPropertyOptional({ example: 'listing-42' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  id?: string;
}

export class BatchRequestDto {
  @ApiProperty({ type: [BatchPointDto], description: '1 to BATCH_MAX_POINTS (default 100) points' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BatchPointDto)
  points!: BatchPointDto[];
}

export class QueryEchoDto {
  @ApiProperty() lat!: number;
  @ApiProperty() lon!: number;
  @ApiProperty() radiusMeters!: number;
  @ApiProperty() carRadiusMeters!: number;
}

export class DataInfoDto {
  @ApiProperty({ description: 'Last successful fetch per data source', additionalProperties: { type: 'string', format: 'date-time' } })
  sources!: Record<string, string>;
  @ApiProperty({ description: 'Age in seconds of the oldest data source' })
  ageSeconds!: number;
}

export class AvailabilityResultDto {
  @ApiProperty() query!: QueryEchoDto;
  @ApiProperty({ description: 'Vehicles of all form factors within range' })
  total!: number;
  @ApiProperty({
    description: 'Vehicles per form factor; car, bicycle, cargo_bicycle and scooter are always present',
    additionalProperties: { type: 'number' },
    example: { car: 4, bicycle: 21, cargo_bicycle: 0, scooter: 12 },
  })
  byFormFactor!: Record<string, number>;
}

export class AvailabilityResponseDto extends AvailabilityResultDto {
  @ApiProperty() data!: DataInfoDto;
}

export class BatchResultDto extends AvailabilityResultDto {
  @ApiPropertyOptional() id?: string;
}

export class BatchResponseDto {
  @ApiProperty({ type: [BatchResultDto] }) results!: BatchResultDto[];
  @ApiProperty() data!: DataInfoDto;
}
