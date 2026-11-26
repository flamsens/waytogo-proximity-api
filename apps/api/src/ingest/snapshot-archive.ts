import { mkdir, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Snapshot } from '../domain/mobility';

/**
 * Historical snapshots, kept for a future "regions with good shared mobility" analysis.
 * One gzipped JSON file per snapshot, named by UTC time so names sort chronologically.
 */

const FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.json\.gz$/;

/** `2026-11-26T08:00:00.000Z` → `2026-11-26T08-00-00Z.json.gz` (no colons: safe on every filesystem). */
export function archiveFileName(at: Date): string {
  return `${at.toISOString().slice(0, 19).replace(/:/g, '-')}Z.json.gz`;
}

function timeFromFileName(name: string): number | null {
  const m = FILE_PATTERN.exec(name);
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`) : null;
}

async function archiveTimes(dir: string): Promise<{ name: string; time: number }[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  return names.flatMap((name) => {
    const time = timeFromFileName(name);
    return time === null ? [] : [{ name, time }];
  });
}

/**
 * Writes `snapshot` to the archive unless the newest archived file is younger than
 * `intervalSeconds`. Returns whether a file was written.
 */
export async function maybeArchive(dir: string, snapshot: Snapshot, now: Date, intervalSeconds: number): Promise<boolean> {
  const newest = Math.max(-Infinity, ...(await archiveTimes(dir)).map((f) => f.time));
  if (now.getTime() - newest < intervalSeconds * 1000) return false;
  await mkdir(dir, { recursive: true });
  const path = join(dir, archiveFileName(now));
  await writeFile(`${path}.tmp`, gzipSync(JSON.stringify(snapshot)));
  await rename(`${path}.tmp`, path);
  return true;
}

/** Deletes archived snapshots older than `retentionDays`. Other files are left alone. Returns the number deleted. */
export async function pruneArchive(dir: string, retentionDays: number, now: Date): Promise<number> {
  const cutoff = now.getTime() - retentionDays * 86_400_000;
  const old = (await archiveTimes(dir)).filter((f) => f.time < cutoff);
  await Promise.all(old.map((f) => unlink(join(dir, f.name))));
  return old.length;
}
