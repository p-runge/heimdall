import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { driftCheckRuns, driftCommits, environmentBranchMappings, type sites } from "@/db/schema";
import { getOctokit } from "@/lib/github";
import { openAlert, resolveAlert } from "@/lib/alerts";

type Site = typeof sites.$inferSelect;

export async function runDriftCheck(site: Site) {
  if (!site.githubOwner || !site.githubRepo) return null;

  const mappings = await db.query.environmentBranchMappings.findMany({
    where: eq(environmentBranchMappings.siteId, site.id),
  });
  const prodMapping = mappings.find((m) => m.isProdBranch);
  const compareMapping = mappings.find((m) => !m.isProdBranch);
  if (!prodMapping || !compareMapping) return null;

  const octokit = getOctokit();
  const { data } = await octokit.rest.repos.compareCommits({
    owner: site.githubOwner,
    repo: site.githubRepo,
    base: prodMapping.branchName,
    head: compareMapping.branchName,
  });

  const [run] = await db
    .insert(driftCheckRuns)
    .values({
      siteId: site.id,
      envMappingId: compareMapping.id,
      // ahead_by = how many commits `head` (compare branch) has that `base` (prod) doesn't —
      // i.e. undeployed work sitting in the compare branch.
      commitsBehind: data.ahead_by,
      commitsAhead: data.behind_by,
      compareUrl: data.html_url,
      status: data.status,
    })
    .returning();

  if (data.commits.length > 0) {
    await db.insert(driftCommits).values(
      data.commits.map((commit) => ({
        driftCheckRunId: run.id,
        sha: commit.sha,
        message: commit.commit.message,
        author: commit.commit.author?.name ?? commit.author?.login ?? null,
        committedAt: commit.commit.author?.date ? new Date(commit.commit.author.date) : null,
      })),
    );
  }

  await evaluateDriftAlerts(site, compareMapping.branchName, run.id);
  return run;
}

async function evaluateDriftAlerts(site: Site, compareBranchName: string, latestRunId: string) {
  const recentRuns = await db.query.driftCheckRuns.findMany({
    where: eq(driftCheckRuns.siteId, site.id),
    orderBy: desc(driftCheckRuns.checkedAt),
    limit: 2,
  });

  const twoConsecutiveDrifted =
    recentRuns.length === 2 && recentRuns.every((run) => run.commitsBehind > 0);

  if (twoConsecutiveDrifted) {
    await openAlert({
      siteId: site.id,
      type: "drift_detected",
      severity: "warning",
      message: `${site.name} is ${recentRuns[0].commitsBehind} commit(s) behind ${compareBranchName}`,
      relatedRunType: "drift_check_run",
      relatedRunId: latestRunId,
    });
  } else if (recentRuns[0]?.commitsBehind === 0) {
    await resolveAlert(site.id, "drift_detected", "Branches back in sync.");
  }
}
