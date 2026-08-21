import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url().optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_CHAT_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_EMBED_MODEL: z.string().default('text-embedding-3-small'),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1).optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1).optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1).optional(),
  PUBLIC_API_KEY: z.string().min(1).optional(),
  JWT_SECRET: z.string().default('fallback-secret-for-jwt-token-signing'),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  if (process.env.NODE_ENV !== 'test') {
    console.error('❌ Environment validation failed:', result.error.format());
    process.exit(1);
  }
}

export const env = result.data || {};
