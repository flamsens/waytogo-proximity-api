import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { SourceStatus } from '../domain/mobility';
import { IngestService } from '../ingest/ingest.service';
import { MOBILITY_STORE, MobilityStore } from '../store/mobility-store';

/** Operational view of the data. Not rate limited, so monitoring can poll it freely. */
@ApiTags('health')
@SkipThrottle({ default: true, batch: true })
@Controller('health')
export class HealthController {
  constructor(
    private readonly ingest: IngestService,
    @Inject(MOBILITY_STORE) private readonly store: MobilityStore,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * - `unavailable` (503): not every source has delivered data yet.
   * - `degraded`: data older than STALE_AFTER_SECONDS, or a source's last fetch failed.
   * - `ok` otherwise. Stale operators (e.g. a frozen Lime feed) are informational only,
   *   so they never cause container restarts.
   */
  @Get()
  @ApiOperation({ summary: 'Data freshness per source and operator' })
  @ApiOkResponse({ description: 'status ok or degraded' })
  @ApiServiceUnavailableResponse({ description: 'status unavailable: data not loaded yet' })
  check() {
    const sources = this.ingest.sourceStatuses();
    const view = this.store.view();
    if (!view || !this.ingest.isReady()) throw new ServiceUnavailableException({ status: 'unavailable', sources });

    const now = Date.now();
    const oldestFetch = Math.min(...Object.values(sources).map((s: SourceStatus) => Date.parse(s.fetchedAt)));
    const ageSeconds = Math.floor((now - oldestFetch) / 1000);

    // Newest record per operator tells whether that operator's feed is still alive.
    const operators: Record<string, string> = {};
    for (const { points } of Object.values(view.snapshot.providers)) {
      for (const p of points) {
        if (!operators[p.operator] || p.recordedAt > operators[p.operator]) operators[p.operator] = p.recordedAt;
      }
    }
    const staleOperators = Object.entries(operators)
      .filter(([, newest]) => now - Date.parse(newest) > this.config.staleOperatorSeconds * 1000)
      .map(([operator]) => operator)
      .sort();

    const degraded = ageSeconds > this.config.staleAfterSeconds || Object.values(sources).some((s) => s.lastError);
    return { status: degraded ? 'degraded' : 'ok', ageSeconds, sources, operators, staleOperators };
  }
}
