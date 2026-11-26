import { BadRequestException, Body, Controller, Get, Header, HttpCode, Inject, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags, ApiTooManyRequestsResponse, ApiServiceUnavailableResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { AvailabilityQueryDto, AvailabilityResponseDto, BatchRequestDto, BatchResponseDto } from './availability.dto';
import { AvailabilityService } from './availability.service';

@ApiTags('availability')
@ApiServiceUnavailableResponse({ description: 'Data not loaded yet' })
@ApiTooManyRequestsResponse({ description: 'Rate limit exceeded' })
@Controller('v1/availability')
export class AvailabilityController {
  constructor(
    private readonly availability: AvailabilityService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  @SkipThrottle({ batch: true })
  @Header('Cache-Control', 'public, max-age=30')
  @ApiOperation({ summary: 'Count shared vehicles near one point' })
  @ApiOkResponse({ type: AvailabilityResponseDto })
  async single(@Query() q: AvailabilityQueryDto): Promise<AvailabilityResponseDto> {
    const view = this.availability.currentView();
    return { ...(await this.availability.query(view, q)), data: this.availability.dataInfo(view) };
  }

  @Post('batch')
  @HttpCode(200)
  @SkipThrottle({ default: true })
  @ApiOperation({ summary: 'Count shared vehicles near many points (one snapshot for all)' })
  @ApiOkResponse({ type: BatchResponseDto })
  async batch(@Body() body: BatchRequestDto): Promise<BatchResponseDto> {
    if (body.points.length > this.config.batchMaxPoints) {
      throw new BadRequestException([`points must contain at most ${this.config.batchMaxPoints} elements`]);
    }
    const view = this.availability.currentView();
    const results = await Promise.all(
      body.points.map(async (p) => ({ id: p.id, ...(await this.availability.query(view, p)) })),
    );
    return { results, data: this.availability.dataInfo(view) };
  }
}
