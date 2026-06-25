import { z } from 'zod';

const Schema = z.object({
  PORT: z.string().default('8080').transform((v) => Number.parseInt(v, 10)),
  NODE_ENV: z.string().default('development'),

  REDIS_URL: z.string().default('redis://localhost:6380/1'),

  S3_ENDPOINT_URL: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  // No dev default: a missing value fails closed when the config is parsed, so a
  // forgotten prod env var can never silently fall back to the publicly-known
  // MinIO root key. Dev supplies these via docker-compose / the shell env; tests
  // via test/setup.ts. Mirrors the API removing the same defaults in config.py.
  S3_ACCESS_KEY_ID: z.string(),
  S3_SECRET_ACCESS_KEY: z.string(),
  S3_BUCKET_IFC: z.string().default('ifc-files'),

  API_BASE_URL: z.string().default('http://localhost:8000'),
  // No dev default (see S3_ACCESS_KEY_ID) — a forgotten prod value fails closed
  // instead of shipping the public dev shared secret used to authenticate
  // callbacks to the API's /internal/jobs/callback endpoint.
  PROCESSOR_SHARED_SECRET: z.string(),

  JOB_TIMEOUT_MS: z
    .string()
    .default('600000')
    .transform((v) => Number.parseInt(v, 10)),
  JOB_CONCURRENCY: z
    .string()
    .default('2')
    .transform((v) => Number.parseInt(v, 10)),
  JOB_MAX_FILE_BYTES: z
    .string()
    .default(String(2 * 1024 * 1024 * 1024))
    .transform((v) => Number.parseInt(v, 10)),

  // IfcImporter geometry tessellation threshold. The default of 1 tessellates
  // EVERY element — including tiny furniture/fixtures/fittings — so they stay
  // visible and clickable in the viewer. Raising it (e.g. 500–3000) skips
  // small-geometry elements, cutting fragment-generation time + .frag size at
  // the cost of that visibility. Kept at 1 by default; tune per deployment only
  // after measuring the trade-off on representative models.
  JOB_GEOMETRY_THRESHOLD: z
    .string()
    .default('1')
    .transform((v) => Number.parseInt(v, 10)),

  EMAIL_TRANSPORT: z.enum(['smtp', 'postmark']).default('smtp'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z
    .string()
    .default('1025')
    .transform((v) => Number.parseInt(v, 10)),
  SMTP_FROM: z.string().default('no-reply@bimdossier.dev'),
  POSTMARK_SERVER_TOKEN: z.string().optional(),
  ACTION_CONCURRENCY: z
    .string()
    .default('10')
    .transform((v) => Number.parseInt(v, 10)),
});

export type Config = z.infer<typeof Schema>;

// Known dev-only credential VALUES. The Schema fields no longer carry these as
// defaults — a missing value fails closed when the config is parsed. These
// constants only let the guard and the boot audit RECOGNISE a dev value supplied
// explicitly. Mirrors `validate_production_config` on the API.
const DEV_PROCESSOR_SHARED_SECRET = 'dev-shared-secret-change-me';
const DEV_S3_ACCESS_KEY_ID = 'bimdossier';
const DEV_S3_SECRET_ACCESS_KEY = 'bimdossier-secret';

// Production is the default posture. Only an explicit NODE_ENV of 'development'
// or 'test' opts out of the guard; an UNSET NODE_ENV is treated as production so
// a forgotten env var fails closed (mirrors the API's DEPLOY_REGION handling).
// Read process.env directly — Schema applies a 'development' default to
// cfg.NODE_ENV that would otherwise mask an unset value as dev.
function isExplicitDev(): boolean {
  const env = process.env.NODE_ENV;
  return env === 'development' || env === 'test';
}

// Boot audit: log the source of each protected secret and the guard posture,
// never the secret itself. Uses console (not the pino logger) to avoid a
// circular import — log.ts calls getConfig() at module load, so config.ts must
// not depend on log.ts. Quiet under tests.
function logSecretSources(cfg: Config): void {
  if (process.env.NODE_ENV === 'test') return;
  const verdict = (value: string, dev: string): string =>
    value === dev ? 'DEV-DEFAULT VALUE in use' : 'custom value';
  const mode = isExplicitDev() ? 'DEV-SKIP' : 'ENFORCED';
  const lines = [
    `Secret source audit (NODE_ENV=${process.env.NODE_ENV ?? '<unset>'}, guard=${mode}):`,
    `  S3_ACCESS_KEY_ID: ${verdict(cfg.S3_ACCESS_KEY_ID, DEV_S3_ACCESS_KEY_ID)}`,
    `  S3_SECRET_ACCESS_KEY: ${verdict(cfg.S3_SECRET_ACCESS_KEY, DEV_S3_SECRET_ACCESS_KEY)}`,
    `  PROCESSOR_SHARED_SECRET: ${verdict(cfg.PROCESSOR_SHARED_SECRET, DEV_PROCESSOR_SHARED_SECRET)}`,
  ];
  // eslint-disable-next-line no-console
  console.info(lines.join('\n'));
}

function assertProductionConfig(cfg: Config): void {
  if (isExplicitDev()) {
    if (process.env.NODE_ENV !== 'test') {
      // eslint-disable-next-line no-console
      console.warn(
        `Production-config guard SKIPPED — NODE_ENV='${process.env.NODE_ENV}'. ` +
          'Dev-default credentials are NOT checked. This MUST NOT appear in production.',
      );
    }
    return;
  }
  const errors: string[] = [];
  if (cfg.PROCESSOR_SHARED_SECRET === DEV_PROCESSOR_SHARED_SECRET) {
    errors.push('PROCESSOR_SHARED_SECRET is the dev default; set a real value.');
  }
  if (cfg.S3_ACCESS_KEY_ID === DEV_S3_ACCESS_KEY_ID) {
    errors.push('S3_ACCESS_KEY_ID is the dev default; set a real value.');
  }
  if (cfg.S3_SECRET_ACCESS_KEY === DEV_S3_SECRET_ACCESS_KEY) {
    errors.push('S3_SECRET_ACCESS_KEY is the dev default; set a real value.');
  }
  if (errors.length > 0) {
    throw new Error(`insecure production configuration:\n  - ${errors.join('\n  - ')}`);
  }
}

let cached: Config | null = null;

export function getConfig(): Config {
  if (cached === null) {
    const parsed = Schema.parse(process.env);
    logSecretSources(parsed);
    assertProductionConfig(parsed);
    cached = parsed;
  }
  return cached;
}

export function resetConfig(): void {
  cached = null;
}

export const QUEUE_NAME = 'jobs';
export const ACTION_QUEUE_NAME = 'actions';
export const SUPPORTED_SCHEMAS = ['IFC2X3', 'IFC4', 'IFC4X3'] as const;
export type SupportedSchema = (typeof SUPPORTED_SCHEMAS)[number];
