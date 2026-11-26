import { z } from 'zod';
import { ProviderFormatError } from '../mobility-provider';

/**
 * Validates every record of an upstream feed individually. Bad records are skipped,
 * but when more than `maxInvalidRatio` of them fail (or the feed isn't a non-empty array)
 * we assume the format changed and refuse the whole feed, so the previous data is kept.
 */
export function parseFeed<T>(
  raw: unknown,
  schema: z.ZodType<T>,
  maxInvalidRatio = 0.5,
): { items: T[]; featureCount: number; skipped: number } {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ProviderFormatError('expected a non-empty JSON array');
  }
  const items: T[] = [];
  for (const record of raw) {
    const parsed = schema.safeParse(record);
    if (parsed.success) items.push(parsed.data);
  }
  const skipped = raw.length - items.length;
  if (skipped / raw.length > maxInvalidRatio) {
    throw new ProviderFormatError(`${skipped} of ${raw.length} records are invalid`);
  }
  return { items, featureCount: raw.length, skipped };
}
