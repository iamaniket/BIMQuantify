import { z } from 'zod';

const Schema = z.object({
  PORT: z.string().default('8080').transform((v) => Number.parseInt(v, 10)),
  NODE_ENV: z.string().default('development'),

  REDIS_URL: z.string().default('redis://localhost:6380/1'),

  S3_ENDPOINT_URL: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().default('bimstitch'),
  S3_SECRET_ACCESS_KEY: z.string().default('bimstitch-secret'),
  S3_BUCKET_IFC: z.string().default('ifc-files'),

  API_BASE_URL: z.string().default('http://localhost:8000'),
  PROCESSOR_SHARED_SECRET: z.string().default('dev-shared-secret-change-me'),

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

  EMAIL_TRANSPORT: z.enum(['smtp', 'postmark']).default('smtp'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z
    .string()
    .default('1025')
    .transform((v) => Number.parseInt(v, 10)),
  SMTP_FROM: z.string().default('no-reply@bimstitch.dev'),
  POSTMARK_SERVER_TOKEN: z.string().optional(),
  ACTION_CONCURRENCY: z
    .string()
    .default('10')
    .transform((v) => Number.parseInt(v, 10)),
});

export type Config = z.infer<typeof Schema>;

// Known dev-only defaults. Outside `NODE_ENV=production` they are convenient;
// in production they must be overridden, so we refuse to start if any is still
// in effect — a forgotten env var crashes the worker at boot instead of running
// with a public credential. Mirrors `validate_production_config` on the API.
const DEV_PROCESSOR_SHARED_SECRET = 'dev-shared-secret-change-me';
const DEV_S3_ACCESS_KEY_ID = 'bimstitch';
const DEV_S3_SECRET_ACCESS_KEY = 'bimstitch-secret';

function assertProductionConfig(cfg: Config): void {
  if (cfg.NODE_ENV !== 'production') return;
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
