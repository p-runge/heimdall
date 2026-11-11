import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  alerts,
  securityHeaderCheckRuns,
  siteSecurityHeaderExpectations,
  type sites,
} from "@/db/schema";
import { fetchHtml } from "@/lib/fetch-html";
import { notifyAlert } from "@/lib/alerts";
import {
  compareWithExpectations,
  describeRegressions,
  evaluateProtections,
  isEvaluableStatus,
  pickSecurityHeaders,
  regressionSeverity,
  type ProtectionKey,
} from "@/lib/security-headers";

type Site = typeof sites.$inferSelect;

const ALERT_TYPE = "security_header_regression" as const;

export async function runSecurityHeaderCheck(site: Site) {
  const result = await fetchHtml(site.primaryUrl);
  // An outage or error page must not read as "every header vanished"; the
  // health check reports those.
  if (!result.ok || !isEvaluableStatus(result.status)) return null;

  const headers = pickSecurityHeaders(result.headers);
  const [run] = await db
    .insert(securityHeaderCheckRuns)
    .values({
      siteId: site.id,
      finalUrl: result.finalUrl,
      httpStatus: result.status,
      headers,
      protections: evaluateProtections(headers, result.finalUrl),
    })
    .returning();

  await reconcileSecurityHeaders(site, run);
  return run;
}

/**
 * Grows the site's expectations with newly seen protections and brings its
 * single security header alert in line with the regressions in `run`.
 *
 * Unlike the shared openAlert/resolveAlert, an acknowledged alert counts as the
 * site's existing alert: otherwise acknowledging it would open a duplicate,
 * with a fresh push, on the next run.
 */
export async function reconcileSecurityHeaders(
  site: Site,
  run: { id: string; protections: ProtectionKey[] },
) {
  const expectations = await db.query.siteSecurityHeaderExpectations.findMany({
    where: eq(siteSecurityHeaderExpectations.siteId, site.id),
  });
  const { newlyExpected, regressions } = compareWithExpectations(run.protections, expectations);

  if (newlyExpected.length > 0) {
    await db
      .insert(siteSecurityHeaderExpectations)
      .values(
        newlyExpected.map((protectionKey) => ({
          siteId: site.id,
          protectionKey,
          status: "expected" as const,
        })),
      )
      // A cron run and a page-view run can race on the first sighting.
      .onConflictDoNothing();
  }

  const existing = await db.query.alerts.findFirst({
    where: and(
      eq(alerts.siteId, site.id),
      eq(alerts.type, ALERT_TYPE),
      inArray(alerts.status, ["open", "acknowledged"]),
    ),
  });

  if (regressions.length === 0) {
    if (existing) {
      await db
        .update(alerts)
        .set({
          status: "resolved",
          resolvedAt: new Date(),
          resolutionNote: "Security headers restored or disabled.",
        })
        .where(eq(alerts.id, existing.id));
    }
    return;
  }

  const message = describeRegressions(site.name, regressions);
  const severity = regressionSeverity(regressions);

  if (!existing) {
    await db.insert(alerts).values({
      siteId: site.id,
      type: ALERT_TYPE,
      severity,
      message,
      relatedRunType: "security_header_check_run",
      relatedRunId: run.id,
    });
    await notifyAlert(ALERT_TYPE, message, severity);
    return;
  }

  await db
    .update(alerts)
    .set({ message, severity, relatedRunId: run.id })
    .where(eq(alerts.id, existing.id));
  // Only an escalation is news; a changed list at the same severity is not.
  if (existing.severity === "warning" && severity === "critical") {
    await notifyAlert(ALERT_TYPE, message, severity);
  }
}
