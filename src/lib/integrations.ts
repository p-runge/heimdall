export type IntegrationKey = "github" | "dataforseo" | "discord";

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
      configured: Boolean(process.env.GITHUB_TOKEN),
      description: "Compares branches via the GitHub API to detect undeployed commits (drift checks).",
      envVars: ["GITHUB_TOKEN"],
    },
    {
      key: "dataforseo",
      name: "DataForSEO",
      configured: Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD),
      description: "Submits and polls Google SERP rank checks for tracked keywords.",
      envVars: ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"],
    },
    {
      key: "discord",
      name: "Discord",
      configured: Boolean(process.env.DISCORD_WEBHOOK_URL),
      description: "Posts alert notifications to a Discord channel via an incoming webhook.",
      envVars: ["DISCORD_WEBHOOK_URL"],
    },
  ];
}

export function isIntegrationConfigured(key: IntegrationKey): boolean {
  return getIntegrationStatuses().find((integration) => integration.key === key)?.configured ?? false;
}
