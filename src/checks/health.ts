import tls from "node:tls";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { healthCheckRuns, sitePagePatterns, type sites } from "@/db/schema";
import { openAlert, resolveAlert } from "@/lib/alerts";
import { fetchHtml } from "@/lib/fetch-html";

const CERT_EXPIRY_WARNING_DAYS = 14;

// Sub-patterns beyond the root are checked on a rolling 10-minute rotation
// (one due per minute) instead of every minute, to keep the added request
// volume to client sites close to today's order of magnitude — see the
// cost comparison in the health-check-page-patterns plan.
const ROTATION_WINDOW_MINUTES = 10;

type Site = typeof sites.$inferSelect;
type PatternTarget = { id: string | null; sampleUrl: string; patternKey: string };

function checkTlsExpiry(hostname: string) {
  return new Promise<{ expiryDate: Date; daysRemaining: number } | null>((resolve) => {
    const socket = tls.connect(
      { host: hostname, port: 443, servername: hostname, timeout: 8000 },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert || !cert.valid_to) {
          resolve(null);
          return;
        }
        const expiryDate = new Date(cert.valid_to);
        const daysRemaining = Math.floor((expiryDate.getTime() - Date.now()) / 86_400_000);
        resolve({ expiryDate, daysRemaining });
      },
    );
    socket.on("error", () => resolve(null));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
  });
}

function scanMetaHygiene(html: string, isHttps: boolean) {
  const $ = cheerio.load(html);
  const title = $("title").first().text().trim();
  const metaDescription = $('meta[name="description"]').attr("content")?.trim();
  const canonical = $('link[rel="canonical"]').attr("href");

  let mixedContent = false;
  if (isHttps) {
    $("[src], [href]").each((_, el) => {
      const value = $(el).attr("src") ?? $(el).attr("href");
      if (value?.startsWith("http://")) mixedContent = true;
    });
  }

  return {
    missingTitle: !title,
    missingMetaDescription: !metaDescription,
    missingCanonical: !canonical,
    mixedContent,
  };
}

/** Root is always checked; sub-patterns rotate one-per-minute across a
 *  10-minute window rather than all being checked every minute. Falls back
 *  to an in-memory root-only target when discovery hasn't run yet. */
function selectTargets(
  patterns: (typeof sitePagePatterns.$inferSelect)[],
  primaryUrl: string,
): PatternTarget[] {
  if (patterns.length === 0) return [{ id: null, sampleUrl: primaryUrl, patternKey: "/" }];

  const root = patterns.find((p) => p.patternKey === "/") ?? {
    id: null,
    sampleUrl: primaryUrl,
    patternKey: "/",
  };
  const subPatterns = patterns.filter((p) => p.patternKey !== "/");

  const currentSlot = Math.floor(Date.now() / 60_000) % ROTATION_WINDOW_MINUTES;
  const dueSubPatterns = subPatterns.filter((_, i) => i % ROTATION_WINDOW_MINUTES === currentSlot);

  return [root, ...dueSubPatterns];
}

export async function runHealthCheck(site: Site) {
  const isHttps = site.primaryUrl.startsWith("https://");
  const hostname = new URL(site.primaryUrl).hostname;
  const tlsResult = isHttps ? await checkTlsExpiry(hostname) : null;

  const patterns = await db.query.sitePagePatterns.findMany({
    where: eq(sitePagePatterns.siteId, site.id),
    orderBy: asc(sitePagePatterns.patternKey),
  });
  const targets = selectTargets(patterns, site.primaryUrl);

  const limit = pLimit(5);
  const runs = await Promise.all(
    targets.map((target) =>
      limit(async () => {
        const fetchResult = await fetchHtml(target.sampleUrl);
        const seoIssues = fetchResult.ok ? scanMetaHygiene(fetchResult.html, isHttps) : undefined;

        const [run] = await db
          .insert(healthCheckRuns)
          .values({
            siteId: site.id,
            sitePagePatternId: target.id,
            httpStatus: fetchResult.ok ? fetchResult.status : null,
            responseTimeMs: fetchResult.responseTimeMs,
            isUp: fetchResult.ok && fetchResult.status < 500,
            errorMessage: fetchResult.ok ? null : fetchResult.errorMessage,
            tlsExpiryDate: tlsResult?.expiryDate,
            tlsDaysRemaining: tlsResult?.daysRemaining,
            seoIssues,
          })
          .returning();

        return run;
      }),
    ),
  );

  await evaluateHealthAlerts(site, tlsResult);
  return runs;
}

/** Re-evaluates alert state for every known pattern, not just the ones
 *  fetched this run — a sub-pattern's last-known state (up to ~10 minutes
 *  old, per the rotation above) still counts. Opens/resolves a single
 *  site_down alert per site listing every currently-failing page type,
 *  rather than one alert per pattern. */
async function evaluateHealthAlerts(
  site: Site,
  tlsResult: { expiryDate: Date; daysRemaining: number } | null,
) {
  const patterns = await db.query.sitePagePatterns.findMany({
    where: eq(sitePagePatterns.siteId, site.id),
  });
  const targets: { id: string | null; patternKey: string }[] =
    patterns.length > 0 ? patterns : [{ id: null, patternKey: "/" }];

  const downPatterns: { patternKey: string; reason: string }[] = [];
  let latestRun: { id: string; checkedAt: Date } | undefined;

  for (const target of targets) {
    const recentRuns = await db.query.healthCheckRuns.findMany({
      where: and(
        eq(healthCheckRuns.siteId, site.id),
        target.id != null ? eq(healthCheckRuns.sitePagePatternId, target.id) : isNull(healthCheckRuns.sitePagePatternId),
      ),
      orderBy: desc(healthCheckRuns.checkedAt),
      limit: 2,
    });
    if (recentRuns[0] && (!latestRun || recentRuns[0].checkedAt > latestRun.checkedAt)) {
      latestRun = recentRuns[0];
    }

    const twoConsecutiveDown = recentRuns.length === 2 && recentRuns.every((run) => !run.isUp);
    if (twoConsecutiveDown) {
      downPatterns.push({
        patternKey: target.patternKey,
        reason: recentRuns[0].errorMessage ?? `HTTP ${recentRuns[0].httpStatus}`,
      });
    }
  }

  if (downPatterns.length > 0) {
    const summary = downPatterns.map((d) => `${d.patternKey} (${d.reason})`).join(", ");
    await openAlert({
      siteId: site.id,
      type: "site_down",
      severity: "critical",
      message: `${site.name} is down on ${downPatterns.length} page type(s): ${summary}`,
      relatedRunType: "health_check_run",
      relatedRunId: latestRun?.id,
    });
  } else {
    await resolveAlert(site.id, "site_down", "All checked pages responded successfully again.");
  }

  if (tlsResult?.daysRemaining != null) {
    if (tlsResult.daysRemaining < CERT_EXPIRY_WARNING_DAYS) {
      await openAlert({
        siteId: site.id,
        type: "cert_expiring",
        severity: tlsResult.daysRemaining < 3 ? "critical" : "warning",
        message: `${site.name}'s TLS certificate expires in ${tlsResult.daysRemaining} day(s)`,
        relatedRunType: "health_check_run",
        relatedRunId: latestRun?.id,
      });
    } else {
      await resolveAlert(site.id, "cert_expiring", "Certificate renewed.");
    }
  }
}
