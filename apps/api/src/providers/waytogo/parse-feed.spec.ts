import { z } from 'zod';
import { parseFeed } from './parse-feed';
import { ProviderFormatError } from '../mobility-provider';

const schema = z.object({ n: z.number() });
const feed = (valid: number, invalid: number) => [
  ...Array.from({ length: valid }, (_, i) => ({ n: i })),
  ...Array.from({ length: invalid }, () => ({ n: 'x' })),
];

describe('parseFeed', () => {
  it.each([[{}], ['<html>'], [[]]])('rejects %p as a format error', (raw) => {
    expect(() => parseFeed(raw, schema)).toThrow(ProviderFormatError);
  });
  it('skips invalid items below the threshold', () => {
    expect(parseFeed(feed(6, 4), schema)).toMatchObject({ featureCount: 10, skipped: 4, items: expect.any(Array) });
    expect(parseFeed(feed(6, 4), schema).items).toHaveLength(6);
  });
  it('fails when more than half is invalid', () => {
    expect(() => parseFeed(feed(4, 6), schema)).toThrow(ProviderFormatError);
  });
});
