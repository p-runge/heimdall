import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { alerts, type alertTypeEnum, type alertSeverityEnum } from "@/db/schema";

type AlertType = (typeof alertTypeEnum.enumValues)[number];
type AlertSeverity = (typeof alertSeverityEnum.enumValues)[number];

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

  await notifyDiscord(alert.message, severity);
  return alert;
}

/** Resolves any open alert of this type for this site (e.g. the site came back up). */
export async function resolveAlert(siteId: string, type: AlertType, note?: string) {
  await db
    .update(alerts)
    .set({ status: "resolved", resolvedAt: new Date(), resolutionNote: note })
    .where(and(eq(alerts.siteId, siteId), eq(alerts.type, type), eq(alerts.status, "open")));
}

async function notifyDiscord(message: string, severity: AlertSeverity) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
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
