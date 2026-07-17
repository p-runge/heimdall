import type { sites } from "@/db/schema";
import { runHealthCheck } from "@/checks/health";
import { runComplianceCheck } from "@/checks/compliance";
import { runDriftCheck } from "@/checks/drift";
import { runPreviewCheck } from "@/checks/preview";

type Site = typeof sites.$inferSelect;

/**
 * Runs every check except the paid SEO/rank check for a site, so any page that
 * loads a site's data can call this first and always render fresh results.
 * Each check already no-ops when its preconditions aren't met (no previewUrl,
 * no GitHub repo, ...); failures are isolated per-check so one broken check
 * (e.g. GitHub API down) never blocks the others or the page render.
 */
export async function runSiteChecks(site: Site) {
  const results = await Promise.allSettled([
    runHealthCheck(site),
    runComplianceCheck(site),
    site.githubOwner && site.githubRepo ? runDriftCheck(site) : Promise.resolve(null),
    runPreviewCheck(site),
  ]);

  for (const result of results) {
    if (result.status === "rejected") {
      console.error(`site check failed for site ${site.id}:`, result.reason);
    }
  }
}
