import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * Load .env from apps/api or the repo root using Node's built-in loader.
 * Real environment variables always win (loadEnvFile never overwrites them).
 */
function loadEnvFiles(): void {
  const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const file of [path.join(apiDir, '.env'), path.resolve(apiDir, '../../.env')]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

const bool = (def: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(def)
    .transform((v) => v === 'true');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4100),
  HOST: z.string().default('0.0.0.0'),
  /** Must be a NON-superuser role: superusers bypass row-level security. */
  DATABASE_URL: z.string().url().default('postgres://mediavault:mediavault@localhost:5432/mediavault'),
  /** Public origin of the web app (used for links in invites and share pages, and the Origin check). */
  APP_ORIGIN: z.string().url().default('http://localhost:5174'),
  /** Public base URL of this API as the browser reaches it (behind the web app's /api proxy in production). */
  PUBLIC_API_URL: z.string().url().default('http://localhost:5174/api'),

  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(14),
  /** HMAC key for signed local-storage URLs. */
  SIGNING_SECRET: z.string().min(32).default('dev-only-signing-secret-change-me-000000'),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('.data/storage'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool('true'),

  /** Per-workspace storage quota. */
  WORKSPACE_QUOTA_BYTES: z.coerce.number().int().positive().default(1024 * 1024 * 1024),
  /** Process media jobs in the API process (free-tier single service) instead of a separate worker. */
  RUN_WORKER_IN_PROCESS: bool('true'),
  /** "Try the demo" gives each visitor a private sample workspace, deleted after 24 hours. */
  DEMO_MODE: bool('true'),
  RATE_LIMIT_ENABLED: bool('true'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (env === process.env) loadEnvFiles();
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === 'production' && cfg.SIGNING_SECRET.startsWith('dev-only')) {
    throw new Error('SIGNING_SECRET must be set in production');
  }
  if (cfg.STORAGE_DRIVER === 's3' && !(cfg.S3_BUCKET && cfg.S3_ACCESS_KEY_ID && cfg.S3_SECRET_ACCESS_KEY)) {
    throw new Error('S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required when STORAGE_DRIVER=s3');
  }
  return cfg;
}
