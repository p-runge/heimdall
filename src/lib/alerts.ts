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

/**
 * How loudly each alert type pushes, keyed by how fast a human has to react —
 * not by how bad the finding sounds. ntfy's top priority vibrates through a
 * silent phone, so spending it on anything but an outage trains us to ignore it.
 *
 * - `max` — the site is offline; every minute costs something.
 * - `high` — interrupts the day: an outage is hours away, or something private
 *   is publicly reachable right now.
 * - `default` — a normal push: worth seeing today, fixable this week.
 * - `low` — arrives silently, read at leisure. Also where the noisy types go:
 *   rank drops fire per keyword and would drown out everything else.
 *
 * Both severities are spelled out per type because the same finding escalates
 * on its own timeline — a certificate with 13 days left is a nudge, the same
 * certificate with 2 days left is nearly an outage.
 */
const NTFY_ALERT_STYLES: Record<
  AlertType,
  { tags: string[]; priority: Record<AlertSeverity, NtfyPriority> }
> = {
  // Emitted as critical: pages are unreachable or erroring.
  site_down: { tags: ["rotating_light"], priority: { warning: "high", critical: "max" } },
  // Critical under 3 days left, warning under 14 — an expired certificate takes
  // the site down just as hard, but there is still a workday to renew it.
  cert_expiring: { tags: ["lock"], priority: { warning: "default", critical: "high" } },
  // Emitted as critical: a preview environment is publicly reachable and
  // indexable. Nothing is down, but unreleased content is in the open.
  preview_exposed: { tags: ["eyes"], priority: { warning: "default", critical: "high" } },
  // Missing Impressum or privacy policy, unconsented Google Fonts. Legal risk
  // that has usually been there a while; it needs a fix, not a fire drill.
  compliance_issue: { tags: ["scales"], priority: { warning: "default", critical: "high" } },
  // No emitter yet; SEO findings are advisory by nature.
  seo_issue: { tags: ["mag"], priority: { warning: "default", critical: "high" } },
  // Open pull requests or production lagging behind the prod branch. A process
  // signal about our own deploys — never urgent, and self-resolving.
  drift_detected: { tags: ["twisted_rightwards_arrows"], priority: { warning: "low", critical: "default" } },
  // Fires once per keyword, so a bad SERP day means a burst of alerts. Business
  // signal, not an incident.
  rank_drop: { tags: ["chart_with_downwards_trend"], priority: { warning: "low", critical: "default" } },
  // No emitter yet; a slower page is a backlog item.
  lighthouse_regression: { tags: ["turtle"], priority: { warning: "low", critical: "default" } },
};

async function notifyNtfy(type: AlertType, message: string, severity: AlertSeverity) {
  const style = NTFY_ALERT_STYLES[type];
  try {
    await publishToNtfy({
      title: `Heimdall — ${ALERT_TYPE_LABELS[type]}`,
      message,
      priority: style.priority[severity],
      tags: style.tags,
    });
  } catch {
    // Best-effort notification; a failed publish must never block check writes.
  }
}
