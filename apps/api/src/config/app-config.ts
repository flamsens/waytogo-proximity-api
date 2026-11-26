import { z } from 'zod';

/**
 * Runtime configuration, read once from environment variables at startup.
 * Invalid values fail fast so a misconfigured container never starts serving.
 */
export interface AppConfig {
  port: number;
  /** Base URL of the waytogo map backend that serves /api/vehicles and /api/stations. */
  upstreamBaseUrl: string;
  /** How often upstream data is ingested. Counts can be up to one interval old. */
  ingestIntervalSeconds: number;
  upstreamTimeoutMs: number;
  /** Last snapshot, so a restart can serve data immediately. */
  snapshotPath: string;
  /** /health reports "degraded" when the data is older than this. */
  staleAfterSeconds: number;
  /** Operators whose newest record is older than this are listed as stale in /health. */
  staleOperatorSeconds: number;
  rateLimitPerMinute: number;
  batchRateLimitPerMinute: number;
  batchMaxPoints: number;
  /** Directory with gzipped historical snapshots (for future coverage analysis). */
  archiveDir: string;
  archiveIntervalSeconds: number;
  /** 0 disables archiving. */
  archiveRetentionDays: number;
  /** Set to true behind a reverse proxy so rate limiting sees the real client IP. */
  trustProxy: boolean;
}

/** DI token for the {@link AppConfig}. */
export const APP_CONFIG = Symbol('APP_CONFIG');

const positiveInt = z.coerce.number().int().positive();

const envSchema = z.object({
  PORT: positiveInt.default(3000),
  UPSTREAM_BASE_URL: z.url().default('https://map.waytogo.be'),
  INGEST_INTERVAL_SECONDS: z.coerce.number().int().min(60).default(3600),
  UPSTREAM_TIMEOUT_MS: positiveInt.default(20000),
  SNAPSHOT_PATH: z.string().min(1).default('/data/snapshot.json'),
  STALE_AFTER_SECONDS: positiveInt.optional(),
  STALE_OPERATOR_SECONDS: positiveInt.default(86400),
  RATE_LIMIT_PER_MINUTE: positiveInt.default(120),
  BATCH_RATE_LIMIT_PER_MINUTE: positiveInt.default(30),
  BATCH_MAX_POINTS: positiveInt.default(100),
  ARCHIVE_DIR: z.string().min(1).default('/data/archive'),
  ARCHIVE_INTERVAL_SECONDS: z.coerce.number().int().min(60).default(3600),
  ARCHIVE_RETENTION_DAYS: z.coerce.number().int().min(0).default(30),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
});

/**
 * Parses and validates the environment.
 * `STALE_AFTER_SECONDS` defaults to 3 × the ingest interval, so a single
 * missed ingest run does not immediately mark the service as degraded.
 * @throws Error listing every invalid variable.
 */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  // Treat empty strings as "not set" so compose files can leave values blank.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration: ${problems.join('; ')}`);
  }
  const e = result.data;
  return {
    port: e.PORT,
    upstreamBaseUrl: e.UPSTREAM_BASE_URL,
    ingestIntervalSeconds: e.INGEST_INTERVAL_SECONDS,
    upstreamTimeoutMs: e.UPSTREAM_TIMEOUT_MS,
    snapshotPath: e.SNAPSHOT_PATH,
    staleAfterSeconds: e.STALE_AFTER_SECONDS ?? 3 * e.INGEST_INTERVAL_SECONDS,
    staleOperatorSeconds: e.STALE_OPERATOR_SECONDS,
    rateLimitPerMinute: e.RATE_LIMIT_PER_MINUTE,
    batchRateLimitPerMinute: e.BATCH_RATE_LIMIT_PER_MINUTE,
    batchMaxPoints: e.BATCH_MAX_POINTS,
    archiveDir: e.ARCHIVE_DIR,
    archiveIntervalSeconds: e.ARCHIVE_INTERVAL_SECONDS,
    archiveRetentionDays: e.ARCHIVE_RETENTION_DAYS,
    trustProxy: e.TRUST_PROXY === 'true',
  };
}
