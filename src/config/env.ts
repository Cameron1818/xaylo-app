import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  GHL_CLIENT_ID: z.string().default(''),
  GHL_CLIENT_SECRET: z.string().default(''),
  GHL_SHARED_SECRET: z.string().default(''),
  GHL_APP_ID: z.string().default(''),
  ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
  SESSION_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().default(''),
  GOOGLE_CLOUD_PROJECT: z.string().default(''),
  GOOGLE_ADS_API_VERSION: z.string().regex(/^v\d+$/).default('v26'),
  OPENAI_API_KEY: z.string().default(''),
  AI_MODEL: z.string().default(''),
  RESEND_API_KEY: z.string().default(''),
  EMAIL_FROM: z.string().default(''),
  FREE_TRIAL_DAYS: z.coerce.number().int().min(0).max(90).default(7),
  FREE_REPORT_LOOKBACK_DAYS: z.coerce.number().int().min(7).max(90).default(7),
  PAID_REPORTS_PER_MONTH: z.coerce.number().int().positive().max(10000).default(30),
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  STRIPE_PRICE_ID: z.string().default(''),
  REPORT_SOURCE_MAX_PAGES: z.coerce.number().int().min(1).max(100).default(20),
  DEV_PREVIEW: z.enum(['true', 'false']).default('false').transform(value => value === 'true')
});

export function getEnv() { return schema.parse(process.env); }
export type Env = ReturnType<typeof getEnv>;
export function ghlConfigured(env: Env = getEnv()) {
  return Boolean(env.GHL_CLIENT_ID && env.GHL_CLIENT_SECRET && env.GHL_SHARED_SECRET && env.GHL_APP_ID);
}
