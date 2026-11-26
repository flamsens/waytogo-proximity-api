import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Snapshot } from '../domain/mobility';
import { loadSnapshot, saveSnapshot } from './snapshot-file';

const snap: Snapshot = { builtAt: '2026-11-26T08:00:00.000Z', providers: {} };

describe('snapshot file', () => {
  it('round-trips', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'snap-')), 'sub', 'snapshot.json');
    await saveSnapshot(path, snap);
    expect(await loadSnapshot(path)).toEqual(snap);
  });
  it('returns null for a missing or corrupt file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'snap-'));
    expect(await loadSnapshot(join(dir, 'missing.json'))).toBeNull();
    await writeFile(join(dir, 'bad.json'), '{not json');
    expect(await loadSnapshot(join(dir, 'bad.json'))).toBeNull();
  });
});
