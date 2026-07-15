import tls from "node:tls";
import * as cheerio from "cheerio";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { healthCheckRuns, type sites } from "@/db/schema";
import { openAlert, resolveAlert } from "@/lib/alerts";
import { fetchHtml } from "@/lib/fetch-html";

const CERT_EXPIRY_WARNING_DAYS = 14;

type Site = typeof sites.$inferSelect;

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

export async function runHealthCheck(site: Site) {
  const fetchResult = await fetchHtml(site.primaryUrl);
  const isHttps = site.primaryUrl.startsWith("https://");
  const hostname = new URL(site.primaryUrl).hostname;

  const tlsResult = isHttps ? await checkTlsExpiry(hostname) : null;
  const seoIssues = fetchResult.ok ? scanMetaHygiene(fetchResult.html, isHttps) : undefined;

  const [run] = await db
    .insert(healthCheckRuns)
    .values({
      siteId: site.id,
      httpStatus: fetchResult.ok ? fetchResult.status : null,
      responseTimeMs: fetchResult.responseTimeMs,
      isUp: fetchResult.ok && fetchResult.status < 500,
      errorMessage: fetchResult.ok ? null : fetchResult.errorMessage,
      tlsExpiryDate: tlsResult?.expiryDate,
      tlsDaysRemaining: tlsResult?.daysRemaining,
      seoIssues,
    })
    .returning();

  await evaluateHealthAlerts(site, run.id);
  return run;
}

async function evaluateHealthAlerts(site: Site, latestRunId: string) {
  const recentRuns = await db.query.healthCheckRuns.findMany({
    where: eq(healthCheckRuns.siteId, site.id),
    orderBy: desc(healthCheckRuns.checkedAt),
    limit: 2,
  });

  const twoConsecutiveDown = recentRuns.length === 2 && recentRuns.every((run) => !run.isUp);
  if (twoConsecutiveDown) {
    await openAlert({
      siteId: site.id,
      type: "site_down",
      severity: "critical",
      message: `${site.name} is down (${recentRuns[0].errorMessage ?? `HTTP ${recentRuns[0].httpStatus}`})`,
      relatedRunType: "health_check_run",
      relatedRunId: latestRunId,
    });
  } else if (recentRuns[0]?.isUp) {
    await resolveAlert(site.id, "site_down", "Site responded successfully again.");
  }

  const latest = recentRuns[0];
  if (latest?.tlsDaysRemaining != null) {
    if (latest.tlsDaysRemaining < CERT_EXPIRY_WARNING_DAYS) {
      await openAlert({
        siteId: site.id,
        type: "cert_expiring",
        severity: latest.tlsDaysRemaining < 3 ? "critical" : "warning",
        message: `${site.name}'s TLS certificate expires in ${latest.tlsDaysRemaining} day(s)`,
        relatedRunType: "health_check_run",
        relatedRunId: latestRunId,
      });
    } else {
      await resolveAlert(site.id, "cert_expiring", "Certificate renewed.");
    }
  }
}
