import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Snapshot } from '../domain/mobility';
import { archiveFileName, maybeArchive, pruneArchive } from './snapshot-archive';

const snap: Snapshot = { builtAt: '2026-11-26T08:00:00.000Z', providers: {} };
const t0 = new Date('2026-11-26T08:00:00Z');
const later = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

describe('snapshot archive', () => {
  it('names files sortably and filesystem-safe', () => {
    expect(archiveFileName(t0)).toBe('2026-11-26T08-00-00Z.json.gz');
  });

  it('archives at most once per interval', async () => {
    const dir = join(await mkdtemp(join(tmpdir(), 'arch-')), 'archive');
    expect(await maybeArchive(dir, snap, t0, 3600)).toBe(true);
    expect(await maybeArchive(dir, snap, later(10), 3600)).toBe(false);
    expect(await maybeArchive(dir, snap, later(61), 3600)).toBe(true);
    const files = (await readdir(dir)).sort();
    expect(files).toHaveLength(2);
    expect(JSON.parse(gunzipSync(await readFile(join(dir, files[0]))).toString())).toEqual(snap);
  });

  it('prunes files older than the retention', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'arch-'));
    const daysAgo = (d: number) => new Date(t0.getTime() - d * 86_400_000);
    for (const name of [archiveFileName(daysAgo(29)), archiveFileName(daysAgo(31)), 'notes.txt']) {
      await writeFile(join(dir, name), 'x');
    }
    expect(await pruneArchive(dir, 30, t0)).toBe(1);
    expect((await readdir(dir)).sort()).toEqual([archiveFileName(daysAgo(29)), 'notes.txt']);
  });
});
