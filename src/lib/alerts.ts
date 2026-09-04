import { and, eq } from "drizzle-orm";
import { env } from "@/env";
import { db } from "@/db";
import { alerts, type alertTypeEnum, type alertSeverityEnum } from "@/db/schema";
import { publishToNtfy, type NtfyPriority } from "@/lib/ntfy";

type AlertType = (typeof alertTypeEnum.enumValues)[number];
type AlertSeverity = (typeof alertSeverityEnum.enumValues)[number];

/** Human-readable names for the alert types, shared by the UI and notifications. */
export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  site_down: "Site down",
  cert_expiring: "Certificate expiring",
  seo_issue: "SEO issue",
  drift_detected: "Deploy drift",
  rank_drop: "Rank drop",
  lighthouse_regression: "Lighthouse regression",
  preview_exposed: "Preview exposed",
  compliance_issue: "Compliance issue",
};

/** Opens an alert of this type for this site, unless one is already open. */
export async function openAlert({
  siteId,
  type,
  severity,
  message,
  relatedRunType,
  relatedRunId,
}: {
  siteId: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  relatedRunType?: string;
  relatedRunId?: string;
}) {
  const existing = await db.query.alerts.findFirst({
    where: and(eq(alerts.siteId, siteId), eq(alerts.type, type), eq(alerts.status, "open")),
  });
  if (existing) return existing;

  const [alert] = await db
    .insert(alerts)
    .values({ siteId, type, severity, message, relatedRunType, relatedRunId })
    .returning();

  await notify(alert.type, alert.message, severity);
  return alert;
}

/** Resolves any open alert of this type for this site (e.g. the site came back up). */
export async function resolveAlert(siteId: string, type: AlertType, note?: string) {
  await db
    .update(alerts)
    .set({ status: "resolved", resolvedAt: new Date(), resolutionNote: note })
    .where(and(eq(alerts.siteId, siteId), eq(alerts.type, type), eq(alerts.status, "open")));
}

/** Fans the alert out to every configured channel; unconfigured ones no-op. */
async function notify(type: AlertType, message: string, severity: AlertSeverity) {
  await Promise.allSettled([
    notifyDiscord(message, severity),
    notifyNtfy(type, message, severity),
  ]);
}

async function notifyDiscord(message: string, severity: AlertSeverity) {
  const webhookUrl = env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `${severity === "critical" ? "🔴" : "🟡"} **Heimdall** — ${message}`,
      }),
    });
  } catch {
    // Best-effort notification; a failed webhook must never block check writes.
  }
}

const NTFY_PRIORITIES: Record<AlertSeverity, NtfyPriority> = {
  critical: "high",
  warning: "default",
};

const NTFY_TAGS: Record<AlertSeverity, string[]> = {
  critical: ["rotating_light"],
  warning: ["warning"],
};

async function notifyNtfy(type: AlertType, message: string, severity: AlertSeverity) {
  try {
    await publishToNtfy({
      title: `Heimdall — ${ALERT_TYPE_LABELS[type]}`,
      message,
      priority: NTFY_PRIORITIES[severity],
      tags: NTFY_TAGS[severity],
    });
  } catch {
    // Best-effort notification; a failed publish must never block check writes.
  }
}
