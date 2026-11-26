import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppModule } from '../app/app.module';
import { configureApp } from '../app/configure-app';
import { APP_CONFIG, AppConfig, loadConfig } from '../config/app-config';
import { MobilityPoint } from '../domain/mobility';
import { IngestService } from '../ingest/ingest.service';
import { MOBILITY_PROVIDERS, MobilityProvider, ProviderResult } from '../providers/mobility-provider';

/** In-memory provider for HTTP tests. `points: null` simulates an upstream that never answers. */
export class FakeProvider implements MobilityProvider {
  constructor(readonly id: string, public points: MobilityPoint[] | null, public error?: Error) {}
  fetchPoints(): Promise<ProviderResult> {
    if (this.error) return Promise.reject(this.error);
    if (this.points === null) return new Promise(() => undefined);
    return Promise.resolve({ points: this.points, featureCount: this.points.length, skipped: 0 });
  }
}

export function fakePoint(lat: number, lon: number, formFactor: string, count = 1, extra: Partial<MobilityPoint> = {}): MobilityPoint {
  return { lat, lon, operator: 'op', formFactor, count, source: 'station', recordedAt: new Date().toISOString(), ...extra };
}

/**
 * Boots the real AppModule with fake providers and a temp data dir, waits for the first ingest
 * (when the fakes answer) and returns the app plus its ingest service.
 */
export async function createTestApp(
  providers: MobilityProvider[],
  env: Record<string, string> = {},
): Promise<{ app: INestApplication; ingest: IngestService; config: AppConfig }> {
  const dir = mkdtempSync(join(tmpdir(), 'api-test-'));
  const config = loadConfig({ SNAPSHOT_PATH: join(dir, 'snapshot.json'), ARCHIVE_DIR: join(dir, 'archive'), ...env });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(MOBILITY_PROVIDERS)
    .useValue(providers)
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, config);
  await app.init();
  const ingest = app.get(IngestService);
  if (providers.every((p) => !(p instanceof FakeProvider) || p.points !== null)) await ingest.runOnce();
  return { app, ingest, config };
}
