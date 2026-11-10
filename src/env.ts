import { createEnv } from "@t3-oss/env-nextjs";
import * as z from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    AUTH_GOOGLE_ID: z.string().min(1),
    AUTH_GOOGLE_SECRET: z.string().min(1),
    AUTH_SECRET: z.string().min(1),
    // Who may sign in: accounts on this Google Workspace domain (checked
    // against the verified `hd` claim), the addresses in ALLOWED_EMAILS, or
    // both. At least one of the two must be set; see createFinalSchema below.
    ALLOWED_EMAIL_DOMAIN: z
      .string()
      .optional()
      .transform((value) => value?.trim() || undefined),
    ALLOWED_EMAILS: z
      .string()
      .optional()
      .transform((value) =>
        (value ?? "")
          .split(",")
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean),
      ),
    // Integrations below are optionally configured per-environment; see
    // src/lib/integrations.ts for the feature checks gated on their presence.
    GITHUB_TOKEN: z.string().optional(),
    DATAFORSEO_LOGIN: z.string().optional(),
    DATAFORSEO_PASSWORD: z.string().optional(),
    DISCORD_WEBHOOK_URL: z.string().optional(),
    // ntfy publishing. The base URL must be reachable from Heimdall's
    // container, which for an ntfy server in another Docker network means its
    // public domain.
    NTFY_BASE_URL: z.url().optional(),
    NTFY_TOKEN: z.string().optional(),
    NTFY_TOPIC: z
      .string()
      .optional()
      .transform((value) => value?.trim() || "heimdall"),
    CRON_SECRET: z.string().optional(),
  },
  client: {},
  experimental__runtimeEnv: {},
  createFinalSchema: (shape, isServer) =>
    z.object(shape).refine(
      (env) => !isServer || Boolean(env.ALLOWED_EMAIL_DOMAIN) || env.ALLOWED_EMAILS.length > 0,
      {
        message: "Set ALLOWED_EMAIL_DOMAIN, ALLOWED_EMAILS or both, otherwise nobody can sign in.",
        path: ["ALLOWED_EMAILS"],
      },
    ),
  // The container image builds without a database or OAuth credentials. Runtime
  // validation still runs: src/instrumentation.ts imports this module on server
  // start, and SKIP_ENV_VALIDATION is set only in the Docker builder stage.
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
