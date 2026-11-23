import { z } from 'zod';

const ServerEnvSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  DAILY_AI_BUDGET_USD: z.coerce.number().positive().finite().default(10.0),
  CATALOG_MEDIA_BUCKET: z.string().min(1).default('catalog-media'),
  RATE_LIMIT_IP_SALT: z.string().default('seamlens-v1-local-salt'),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

/**
 * Parses server environment variables lazily without requiring secrets at import time.
 */
export function getServerEnv(): ServerEnv {
  return ServerEnvSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL || undefined,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || undefined,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || undefined,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || undefined,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || undefined,
    DAILY_AI_BUDGET_USD: process.env.DAILY_AI_BUDGET_USD || undefined,
    CATALOG_MEDIA_BUCKET: process.env.CATALOG_MEDIA_BUCKET || undefined,
    RATE_LIMIT_IP_SALT: process.env.RATE_LIMIT_IP_SALT || undefined,
  });
}

export function getDatabaseUrl(): string {
  const { DATABASE_URL } = getServerEnv();
  if (!DATABASE_URL) {
    throw new Error('Missing required environment variable: DATABASE_URL');
  }
  return DATABASE_URL;
}

export function getSupabasePublicConfig(): { url: string; anonKey: string } {
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = getServerEnv();
  if (!NEXT_PUBLIC_SUPABASE_URL || !NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error(
      'Missing required Supabase public configuration: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY'
    );
  }
  return {
    url: NEXT_PUBLIC_SUPABASE_URL,
    anonKey: NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

export function getSupabaseServiceConfig(): { url: string; serviceRoleKey: string } {
  const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();
  if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'Missing required Supabase service configuration: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'
    );
  }
  return {
    url: NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  };
}

export function getOptionalPublicSupabaseUrl(): string | null {
  return getServerEnv().NEXT_PUBLIC_SUPABASE_URL ?? null;
}

export function getGeminiApiKey(): string {
  const { GEMINI_API_KEY } = getServerEnv();
  if (!GEMINI_API_KEY) {
    throw new Error('Missing required environment variable: GEMINI_API_KEY');
  }
  return GEMINI_API_KEY;
}

export function getDailyAiBudgetUsd(): number {
  return getServerEnv().DAILY_AI_BUDGET_USD;
}

export function getCatalogMediaBucket(): string {
  return getServerEnv().CATALOG_MEDIA_BUCKET;
}

export function getRateLimitIpSalt(): string {
  return getServerEnv().RATE_LIMIT_IP_SALT;
}

// Gemini Developer API standard paid-tier prices, USD per million tokens.
// https://ai.google.dev/gemini-api/docs/pricing (2026-11-22).
// Keep each model paired with the request shape and bounds tested by its adapter.
const tokenPrice = z.coerce.number().finite().positive();
const GeminiConfigSchema = z.object({
  visionModel: z.literal('gemini-3.5-flash-lite').default('gemini-3.5-flash-lite'),
  embeddingModel: z.literal('gemini-embedding-001').default('gemini-embedding-001'),
  visionInputUsdPerMillion: tokenPrice.default(0.30),
  visionOutputUsdPerMillion: tokenPrice.default(2.50),
  embeddingInputUsdPerMillion: tokenPrice.default(0.15),
});

export function getGeminiConfig(): z.infer<typeof GeminiConfigSchema> {
  return GeminiConfigSchema.parse({
    visionModel: process.env.GEMINI_VISION_MODEL,
    embeddingModel: process.env.GEMINI_EMBEDDING_MODEL,
    visionInputUsdPerMillion: process.env.GEMINI_VISION_INPUT_USD_PER_MILLION,
    visionOutputUsdPerMillion: process.env.GEMINI_VISION_OUTPUT_USD_PER_MILLION,
    embeddingInputUsdPerMillion: process.env.GEMINI_EMBEDDING_INPUT_USD_PER_MILLION,
  });
}
