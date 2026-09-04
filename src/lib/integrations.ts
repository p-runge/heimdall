import { env } from "@/env";
import { isNtfyConfigured } from "@/lib/ntfy";

export type IntegrationKey = "github" | "dataforseo" | "discord" | "ntfy";

export interface IntegrationStatus {
  key: IntegrationKey;
  name: string;
  configured: boolean;
  description: string;
  envVars: string[];
}

export function getIntegrationStatuses(): IntegrationStatus[] {
  return [
    {
      key: "github",
      name: "GitHub",
      configured: Boolean(env.GITHUB_TOKEN),
      description: "Tracks open pull requests against the prod branch and deployment lag via the GitHub API (drift checks).",
      envVars: ["GITHUB_TOKEN"],
    },
    {
      key: "dataforseo",
      name: "DataForSEO",
      configured: Boolean(env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD),
      description: "Submits and polls Google SERP rank checks for tracked keywords.",
      envVars: ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"],
    },
    {
      key: "discord",
      name: "Discord",
      configured: Boolean(env.DISCORD_WEBHOOK_URL),
      description: "Posts alert notifications to a Discord channel via an incoming webhook.",
      envVars: ["DISCORD_WEBHOOK_URL"],
    },
    {
      key: "ntfy",
      name: "ntfy",
      configured: isNtfyConfigured(),
      description: "Pushes alert notifications to phones via ntfy. The token authenticates the publisher account against a private ntfy server; public ones take posts without it.",
      envVars: ["NTFY_BASE_URL", "NTFY_TOKEN"],
    },
  ];
}

export function isIntegrationConfigured(key: IntegrationKey): boolean {
  return getIntegrationStatuses().find((integration) => integration.key === key)?.configured ?? false;
}
