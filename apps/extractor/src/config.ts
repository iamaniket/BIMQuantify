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
  EXTRACTOR_SHARED_SECRET: z.string().default('dev-shared-secret-change-me'),

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
});

export type Config = z.infer<typeof Schema>;

let cached: Config | null = null;

export function getConfig(): Config {
  if (cached === null) {
    cached = Schema.parse(process.env);
  }
  return cached;
}

export function resetConfig(): void {
  cached = null;
}

export const QUEUE_NAME = 'ifc-extraction';
export const SUPPORTED_SCHEMAS = ['IFC2X3', 'IFC4', 'IFC4X3'] as const;
export type SupportedSchema = (typeof SUPPORTED_SCHEMAS)[number];
