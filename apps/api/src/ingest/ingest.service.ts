import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ProviderData, Snapshot, SourceStatus } from '../domain/mobility';
import { MOBILITY_PROVIDERS, MobilityProvider } from '../providers/mobility-provider';
import { MOBILITY_STORE, MobilityStore } from '../store/mobility-store';
import { maybeArchive, pruneArchive } from './snapshot-archive';
import { loadSnapshot, saveSnapshot } from './snapshot-file';

const INTERVAL_NAME = 'ingest';

/**
 * Periodically pulls every provider and publishes the result to the store.
 *
 * - Each provider keeps its last good data: one failing source never blanks the others.
 * - Runs never overlap; a run that is still busy is simply joined.
 * - Every successful run is persisted (fast restarts) and, at most hourly, archived.
 */
@Injectable()
export class IngestService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(IngestService.name);
  private readonly abort = new AbortController();
  /** Last good data per provider id. */
  private data: Record<string, ProviderData> = {};
  /** Failures of providers that never delivered data yet (so /health can show them). */
  private pendingErrors: Record<string, Pick<SourceStatus, 'lastAttemptAt' | 'lastError'>> = {};
  private running: Promise<void> | null = null;

  constructor(
    @Inject(MOBILITY_PROVIDERS) private readonly providers: MobilityProvider[],
    @Inject(MOBILITY_STORE) private readonly store: MobilityStore,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  /** Serve the snapshot on disk right away, then fetch fresh data and start the interval. */
  async onApplicationBootstrap(): Promise<void> {
    const saved = await loadSnapshot(this.config.snapshotPath);
    if (saved) {
      this.data = saved.providers;
      this.store.replace(saved);
      this.logger.log(`Loaded snapshot from ${saved.builtAt}`);
    }
    void this.runOnce();
    const timer = setInterval(() => void this.runOnce(), this.config.ingestIntervalSeconds * 1000);
    this.scheduler.addInterval(INTERVAL_NAME, timer);
  }

  onModuleDestroy(): void {
    this.abort.abort();
    if (this.scheduler.doesExist('interval', INTERVAL_NAME)) this.scheduler.deleteInterval(INTERVAL_NAME);
  }

  /** Runs one ingest, or joins the one in progress. Never rejects. */
  runOnce(): Promise<void> {
    this.running ??= this.ingest().finally(() => (this.running = null));
    return this.running;
  }

  /** True once every registered provider has delivered data at least once. */
  isReady(): boolean {
    return this.providers.every((p) => this.data[p.id] !== undefined);
  }

  /** Status per provider id, including providers that never succeeded yet. */
  sourceStatuses(): Record<string, SourceStatus> {
    const statuses: Record<string, SourceStatus> = {};
    for (const p of this.providers) {
      const pending = this.pendingErrors[p.id];
      statuses[p.id] = this.data[p.id]?.status ?? {
        fetchedAt: '',
        featureCount: 0,
        skipped: 0,
        lastAttemptAt: pending?.lastAttemptAt ?? '',
        lastError: pending?.lastError,
      };
    }
    return statuses;
  }

  private async ingest(): Promise<void> {
    const now = new Date().toISOString();
    const results = await Promise.allSettled(this.providers.map((p) => p.fetchPoints(this.abort.signal)));
    let anySuccess = false;

    results.forEach((result, i) => {
      const id = this.providers[i].id;
      if (result.status === 'fulfilled') {
        anySuccess = true;
        const { points, featureCount, skipped } = result.value;
        this.data[id] = { points, status: { fetchedAt: now, lastAttemptAt: now, featureCount, skipped } };
        delete this.pendingErrors[id];
        return;
      }
      const lastError = result.reason instanceof Error ? result.reason.message : String(result.reason);
      this.logger.warn(`Provider ${id} failed, keeping previous data: ${lastError}`);
      const previous = this.data[id];
      if (previous) {
        this.data[id] = { ...previous, status: { ...previous.status, lastAttemptAt: now, lastError } };
      } else {
        this.pendingErrors[id] = { lastAttemptAt: now, lastError };
      }
    });

    if (!anySuccess) return;
    const snapshot: Snapshot = { builtAt: now, providers: { ...this.data } };
    this.store.replace(snapshot);
    await this.persist(snapshot);
  }

  /** Disk problems are logged, never fatal: serving data matters more than keeping files. */
  private async persist(snapshot: Snapshot): Promise<void> {
    try {
      await saveSnapshot(this.config.snapshotPath, snapshot);
    } catch (error) {
      this.logger.error(`Could not save snapshot: ${(error as Error).message}`);
    }
    if (this.config.archiveRetentionDays <= 0) return;
    try {
      const now = new Date(snapshot.builtAt);
      await maybeArchive(this.config.archiveDir, snapshot, now, this.config.archiveIntervalSeconds);
      await pruneArchive(this.config.archiveDir, this.config.archiveRetentionDays, now);
    } catch (error) {
      this.logger.error(`Could not archive snapshot: ${(error as Error).message}`);
    }
  }
}
