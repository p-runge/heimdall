import { createEnv } from "@t3-oss/env-nextjs";
import * as z from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    AUTH_GOOGLE_ID: z.string().min(1),
    AUTH_GOOGLE_SECRET: z.string().min(1),
    AUTH_SECRET: z.string().min(1),
    ALLOWED_EMAIL_DOMAIN: z.string().min(1),
    // Integrations below are optionally configured per-environment; see
    // src/lib/integrations.ts for the feature checks gated on their presence.
    GITHUB_TOKEN: z.string().optional(),
    DATAFORSEO_LOGIN: z.string().optional(),
    DATAFORSEO_PASSWORD: z.string().optional(),
    DISCORD_WEBHOOK_URL: z.string().optional(),
    CRON_SECRET: z.string().optional(),
  },
  client: {},
  experimental__runtimeEnv: {},
});
