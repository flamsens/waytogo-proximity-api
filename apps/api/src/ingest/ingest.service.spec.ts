import { SchedulerRegistry } from '@nestjs/schedule';
import { mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../config/app-config';
import { MobilityPoint } from '../domain/mobility';
import { MobilityProvider, ProviderResult } from '../providers/mobility-provider';
import { InMemoryMobilityStore } from '../store/in-memory-mobility-store';
import { IngestService } from './ingest.service';

const pt = (operator: string): MobilityPoint => ({
  lat: 51, lon: 4, operator, formFactor: 'bicycle', count: 1, source: 'free_floating', recordedAt: '2026-11-26T08:00:00Z',
});
const ok = (operator: string): ProviderResult => ({ points: [pt(operator)], featureCount: 1, skipped: 0 });

class FakeProvider implements MobilityProvider {
  calls = 0;
  constructor(readonly id: string, public behaviour: () => Promise<ProviderResult>) {}
  fetchPoints() {
    this.calls++;
    return this.behaviour();
  }
}

async function setup(env: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ingest-'));
  const config = loadConfig({ SNAPSHOT_PATH: join(dir, 'snapshot.json'), ARCHIVE_DIR: join(dir, 'archive'), ...env });
  const a = new FakeProvider('a', async () => ok('opA'));
  const b = new FakeProvider('b', async () => ok('opB'));
  const store = new InMemoryMobilityStore();
  const service = new IngestService([a, b], store, config, new SchedulerRegistry());
  return { dir, config, a, b, store, service };
}

describe('IngestService', () => {
  it('loads all providers into the store and writes the snapshot file', async () => {
    const { service, store, config } = await setup();
    await service.runOnce();
    expect(Object.keys(store.view()!.snapshot.providers).sort()).toEqual(['a', 'b']);
    expect(service.isReady()).toBe(true);
    expect(existsSync(config.snapshotPath)).toBe(true);
    expect(existsSync(config.archiveDir)).toBe(true);
  });

  it('keeps the previous data of a failing provider', async () => {
    const { service, store, b } = await setup();
    await service.runOnce();
    const before = service.sourceStatuses().b.fetchedAt;
    b.behaviour = async () => { throw new Error('upstream down'); };
    await service.runOnce();
    expect(store.view()!.snapshot.providers.b.points).toHaveLength(1);
    expect(service.sourceStatuses().b).toMatchObject({ fetchedAt: before, lastError: 'upstream down' });
    expect(service.sourceStatuses().a.lastError).toBeUndefined();
  });

  it('is not ready while a provider never succeeded', async () => {
    const { service, b } = await setup();
    b.behaviour = async () => { throw new Error('down'); };
    await service.runOnce();
    expect(service.isReady()).toBe(false);
    expect(service.sourceStatuses().b.lastError).toBe('down');
  });

  it('never runs two ingests at once', async () => {
    const { service, a } = await setup();
    a.behaviour = () => new Promise((resolve) => setTimeout(() => resolve(ok('opA')), 50));
    await Promise.all([service.runOnce(), service.runOnce()]);
    expect(a.calls).toBe(1);
  });

  it('does not archive when retention is 0', async () => {
    const { service, config } = await setup({ ARCHIVE_RETENTION_DAYS: '0' });
    await service.runOnce();
    expect(existsSync(config.archiveDir)).toBe(false);
  });

  it('still updates the store when the archive dir is unwritable', async () => {
    // The archive "directory" is below a regular file, so mkdir fails with ENOTDIR.
    const { service, store, config } = await setup();
    (config as { archiveDir: string }).archiveDir = join(config.snapshotPath, 'archive');
    await service.runOnce();
    expect(store.view()).not.toBeNull();
  });

  it('serves the snapshot file on bootstrap before fetching', async () => {
    const first = await setup();
    await first.service.runOnce();
    const store = new InMemoryMobilityStore();
    const slow = new FakeProvider('a', () => new Promise(() => undefined));
    const service = new IngestService([slow, new FakeProvider('b', () => new Promise(() => undefined))], store, first.config, new SchedulerRegistry());
    await service.onApplicationBootstrap();
    expect(service.isReady()).toBe(true);
    expect(store.view()).not.toBeNull();
    service.onModuleDestroy();
  });
});
