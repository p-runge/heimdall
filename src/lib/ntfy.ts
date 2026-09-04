import { env } from "@/env";

/**
 * The one topic Heimdall publishes to. Fixed in code rather than configured:
 * the ntfy account behind NTFY_TOKEN has write-only access to exactly this
 * topic, so pointing it elsewhere could only produce rejected posts.
 */
const TOPIC = "heimdall";

/** Named levels mapped onto ntfy's 1..5 scale. See https://docs.ntfy.sh/publish/#message-priority */
const PRIORITIES = { min: 1, low: 2, default: 3, high: 4, max: 5 } as const;

export type NtfyPriority = keyof typeof PRIORITIES;

export interface NtfyMessage {
  message: string;
  title?: string;
  priority?: NtfyPriority;
  /** Emoji shortcodes shown next to the title, e.g. ["rotating_light"]. */
  tags?: string[];
  /** URL opened when the notification is tapped. */
  click?: string;
}

export function isNtfyConfigured(): boolean {
  return Boolean(env.NTFY_BASE_URL);
}

/**
 * Publishes to ntfy via the JSON endpoint — a POST to the server root with the
 * topic in the body. The header-based endpoint carries title and message as
 * latin-1 HTTP headers, which mangles everything outside that charset (umlauts
 * in site names, for one). See https://docs.ntfy.sh/publish/#publish-as-json
 *
 * No-ops while the server is unset; throws when ntfy rejects the post.
 */
export async function publishToNtfy({
  message,
  title,
  priority = "default",
  tags,
  click,
}: NtfyMessage): Promise<void> {
  const baseUrl = env.NTFY_BASE_URL;
  if (!baseUrl) return;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (env.NTFY_TOKEN) headers.Authorization = `Bearer ${env.NTFY_TOKEN}`;

  const response = await fetch(baseUrl.replace(/\/+$/, ""), {
    method: "POST",
    headers,
    body: JSON.stringify({
      topic: TOPIC,
      message,
      priority: PRIORITIES[priority],
      ...(title ? { title } : {}),
      ...(tags?.length ? { tags } : {}),
      ...(click ? { click } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `ntfy publish failed: ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`,
    );
  }
}
