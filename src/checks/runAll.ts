import type { sites } from "@/db/schema";
import { runHealthCheck } from "@/checks/health";
import { runComplianceCheck } from "@/checks/compliance";
import { runDriftCheck } from "@/checks/drift";
import { runPreviewCheck } from "@/checks/preview";

type Site = typeof sites.$inferSelect & {
  healthCheckRuns: { checkedAt: Date }[];
  complianceCheckRuns: { checkedAt: Date }[];
  driftCheckRuns: { checkedAt: Date }[];
  previewCheckRuns: { checkedAt: Date }[];
};

// Every page view re-runs these live so panels reflect current state — but
// without that, repeat navigation to the same site (back/forward, re-clicking
// the link; the client-side route cache for this page is effectively off
// because of loading.tsx) would re-run every live check on every single
// visit: TLS handshake, HTTP fetch to the target site, GitHub API calls, plus
// a DB write each time. None of this data changes meaningfully inside a
// minute, so skip a check whose last run is still within this window rather
// than hammering the target site/GitHub for no new information.
const CHECK_THROTTLE_MS = 60_000;

function isRecent(lastRuns: { checkedAt: Date }[]) {
  const last = lastRuns[0];
  return last != null && Date.now() - last.checkedAt.getTime() < CHECK_THROTTLE_MS;
}

/**
 * Runs every check except the paid SEO/rank check for a site, so any page that
 * loads a site's data can call this first and always render fresh results.
 * Each check already no-ops when its preconditions aren't met (no previewUrl,
 * no GitHub repo, ...); failures are isolated per-check so one broken check
 * (e.g. GitHub API down) never blocks the others or the page render.
 */
export async function runSiteChecks(site: Site) {
  const hasGithub = Boolean(site.githubOwner && site.githubRepo);
  const skipHealth = isRecent(site.healthCheckRuns);
  const skipCompliance = isRecent(site.complianceCheckRuns);
  const skipDrift = hasGithub && isRecent(site.driftCheckRuns);
  const skipPreview = isRecent(site.previewCheckRuns);

  const results = await Promise.allSettled([
    skipHealth ? Promise.resolve(null) : runHealthCheck(site),
    skipCompliance ? Promise.resolve(null) : runComplianceCheck(site),
    hasGithub && !skipDrift ? runDriftCheck(site) : Promise.resolve(null),
    skipPreview ? Promise.resolve(null) : runPreviewCheck(site),
  ]);
  const [, , driftResult] = results;

  for (const result of results) {
    if (result.status === "rejected") {
      console.error(`site check failed for site ${site.id}:`, result.reason);
    }
  }

  // The drift check is the one whose failure mode (bad branch name, GitHub
  // API error) is worth surfacing on the page instead of just the log — the
  // others already encode "couldn't check" as a normal falsy result. A
  // throttled (skipped) drift check has no fresh error to report; the banner
  // will reappear on the next real check if the problem persists.
  const driftError =
    driftResult.status === "fulfilled" && driftResult.value && "error" in driftResult.value
      ? driftResult.value.error
      : driftResult.status === "rejected"
        ? String(driftResult.reason)
        : null;

  const ranAnyCheck = !skipHealth || !skipCompliance || (hasGithub && !skipDrift) || !skipPreview;

  return { driftError, ranAnyCheck };
}
