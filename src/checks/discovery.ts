import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { sitePagePatterns, sites } from "@/db/schema";
import { discoverSitemapUrls, groupIntoPatterns } from "@/lib/sitemap";

// Bounds the every-minute health check's fan-out (via the rotation in
// runHealthCheck) — raise later if outbound traffic/duration has headroom.
export const MAX_PATTERNS_PER_SITE = 20;

type Site = typeof sites.$inferSelect;

/** Refreshes the known page-type patterns for a site from its sitemap. Cheap
 *  and infrequent (daily cron) by design — the every-minute health check just
 *  reads whatever this last wrote, it never re-parses the sitemap itself. */
export async function runPageDiscovery(site: Site) {
  let urls: string[] | null;
  try {
    urls = await discoverSitemapUrls(site.primaryUrl);
  } catch {
    // Transient fetch/network failure — leave existing patterns untouched
    // rather than pruning good data because of a hiccup.
    return { skipped: true as const };
  }

  const allPatterns = groupIntoPatterns(urls ?? [], site.primaryUrl).sort(
    (a, b) => b.urlCount - a.urlCount,
  );
  const grouped = allPatterns.slice(0, MAX_PATTERNS_PER_SITE);
  const runStartedAt = new Date();

  for (const pattern of grouped) {
    await db
      .insert(sitePagePatterns)
      .values({ siteId: site.id, ...pattern, lastSeenAt: runStartedAt })
      .onConflictDoUpdate({
        target: [sitePagePatterns.siteId, sitePagePatterns.patternKey],
        set: { sampleUrl: pattern.sampleUrl, urlCount: pattern.urlCount, lastSeenAt: runStartedAt },
      });
  }

  // Patterns that existed before this run but weren't touched by it no longer
  // appear in the sitemap — prune them. Only reached after a successful
  // discovery, so a transient failure above never wipes a working pattern set.
  await db
    .delete(sitePagePatterns)
    .where(and(eq(sitePagePatterns.siteId, site.id), lt(sitePagePatterns.lastSeenAt, runStartedAt)));

  // Recorded even when nothing was truncated, so the UI's "N of M" warning
  // clears itself the moment a site drops back under the cap.
  await db
    .update(sites)
    .set({ discoveredPatternCount: allPatterns.length })
    .where(eq(sites.id, site.id));

  return { skipped: false as const, patternCount: grouped.length, discoveredCount: allPatterns.length };
}
