import { loadConfig } from './app-config';

describe('loadConfig', () => {
  it('returns the documented defaults', () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      upstreamBaseUrl: 'https://map.waytogo.be',
      ingestIntervalSeconds: 3600,
      upstreamTimeoutMs: 20000,
      snapshotPath: '/data/snapshot.json',
      staleAfterSeconds: 10800,
      staleOperatorSeconds: 86400,
      rateLimitPerMinute: 120,
      batchRateLimitPerMinute: 30,
      batchMaxPoints: 100,
      archiveDir: '/data/archive',
      archiveIntervalSeconds: 3600,
      archiveRetentionDays: 30,
      trustProxy: false,
    });
  });

  it('allows archive retention 0 (disabled)', () => {
    expect(loadConfig({ ARCHIVE_RETENTION_DAYS: '0' }).archiveRetentionDays).toBe(0);
  });

  it('derives staleAfterSeconds from the ingest interval', () => {
    expect(loadConfig({ INGEST_INTERVAL_SECONDS: '600' }).staleAfterSeconds).toBe(1800);
    expect(
      loadConfig({ INGEST_INTERVAL_SECONDS: '600', STALE_AFTER_SECONDS: '900' }).staleAfterSeconds,
    ).toBe(900);
  });

  it('parses booleans and numbers', () => {
    const c = loadConfig({ TRUST_PROXY: 'true', PORT: '8080' });
    expect(c.trustProxy).toBe(true);
    expect(c.port).toBe(8080);
  });

  it('rejects invalid values naming the variable', () => {
    expect(() => loadConfig({ INGEST_INTERVAL_SECONDS: '59' })).toThrow(/INGEST_INTERVAL_SECONDS/);
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
  });
});
