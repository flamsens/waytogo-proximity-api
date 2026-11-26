import { Logger } from '@nestjs/common';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Snapshot } from '../domain/mobility';

const logger = new Logger('SnapshotFile');

/** Writes the snapshot atomically (temp file + rename), so a crash never leaves a half-written file. */
export async function saveSnapshot(path: string, snapshot: Snapshot): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(snapshot));
  await rename(tmp, path);
}

/** Reads the last snapshot; a missing or unreadable file just means "start without data". */
export async function loadSnapshot(path: string): Promise<Snapshot | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Snapshot;
    return parsed && typeof parsed.providers === 'object' ? parsed : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn(`Ignoring unreadable snapshot ${path}: ${(error as Error).message}`);
    }
    return null;
  }
}
