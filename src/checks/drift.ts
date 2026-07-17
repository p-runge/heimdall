import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { driftCheckRuns, driftPullRequests, type sites } from "@/db/schema";
import { getOctokit } from "@/lib/github";
import { openAlert, resolveAlert } from "@/lib/alerts";

type Site = typeof sites.$inferSelect;

const STALE_PR_MS = 3 * 24 * 60 * 60 * 1000;

function friendlyGithubError(err: unknown, context: string) {
  const status = err && typeof err === "object" && "status" in err ? err.status : undefined;
  if (status === 404) return `${context} — check that it exists and the token can access it.`;
  return `${context}: ${err instanceof Error ? err.message : String(err)}`;
}

export async function runDriftCheck(site: Site) {
  if (!site.githubOwner || !site.githubRepo) return null;

  const prodBranch = site.prodBranch;
  const octokit = getOctokit();

  // Also doubles as an "does this branch exist?" check, since a bad branch
  // name 404s here rather than surfacing later as an empty PR list.
  let branchHeadSha: string;
  try {
    const { data: branch } = await octokit.rest.repos.getBranch({
      owner: site.githubOwner,
      repo: site.githubRepo,
      branch: prodBranch,
    });
    branchHeadSha = branch.commit.sha;
  } catch (err) {
    return {
      error: friendlyGithubError(
        err,
        `Branch "${prodBranch}" doesn't exist in ${site.githubOwner}/${site.githubRepo}`,
      ),
    };
  }

  // Open, non-draft PRs targeting the prod branch represent finished features
  // waiting to be merged/deployed — the thing this check exists to catch.
  let openPRs;
  try {
    const { data: prs } = await octokit.rest.pulls.list({
      owner: site.githubOwner,
      repo: site.githubRepo,
      base: prodBranch,
      state: "open",
      per_page: 100,
    });
    openPRs = prs.filter((pr) => !pr.draft);
  } catch (err) {
    return {
      error: friendlyGithubError(err, `Couldn't list pull requests for ${site.githubOwner}/${site.githubRepo}`),
    };
  }

  // GitHub Deployments (e.g. created by Vercel's GitHub integration) tell us
  // what's actually live, separate from what's merged. Soft-degrade to null
  // when a repo has none — not every repo uses a provider that records them.
  let deploymentSha: string | null = null;
  let deploymentCommitsBehind: number | null = null;
  try {
    const { data: deployments } = await octokit.rest.repos.listDeployments({
      owner: site.githubOwner,
      repo: site.githubRepo,
      environment: "production",
      per_page: 1,
    });
    if (deployments.length > 0) {
      deploymentSha = deployments[0].sha;
      deploymentCommitsBehind =
        deploymentSha === branchHeadSha
          ? 0
          : (
              await octokit.rest.repos.compareCommits({
                owner: site.githubOwner,
                repo: site.githubRepo,
                base: deploymentSha,
                head: branchHeadSha,
              })
            ).data.ahead_by;
    }
  } catch {
    deploymentSha = null;
    deploymentCommitsBehind = null;
  }

  const [run] = await db
    .insert(driftCheckRuns)
    .values({ siteId: site.id, branchHeadSha, deploymentSha, deploymentCommitsBehind })
    .returning();

  if (openPRs.length > 0) {
    await db.insert(driftPullRequests).values(
      openPRs.map((pr) => ({
        driftCheckRunId: run.id,
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        branchName: pr.head.ref,
        authorLogin: pr.user?.login ?? null,
        prCreatedAt: new Date(pr.created_at),
      })),
    );
  }

  await evaluateDriftAlerts(site, run.id, openPRs);
  return run;
}

async function evaluateDriftAlerts(
  site: Site,
  latestRunId: string,
  openPRs: { title: string; created_at: string }[],
) {
  const now = Date.now();
  const stalePRs = openPRs.filter((pr) => now - new Date(pr.created_at).getTime() >= STALE_PR_MS);

  // Debounce the deployment-lag signal over 2 consecutive runs so an
  // in-flight deploy (merged, CI still building) doesn't fire a false alert.
  const recentRuns = await db.query.driftCheckRuns.findMany({
    where: eq(driftCheckRuns.siteId, site.id),
    orderBy: desc(driftCheckRuns.checkedAt),
    limit: 2,
  });
  const deploymentPersistentlyBehind =
    recentRuns.length === 2 &&
    recentRuns.every((run) => run.deploymentCommitsBehind != null && run.deploymentCommitsBehind > 0);

  if (stalePRs.length === 0 && !deploymentPersistentlyBehind) {
    await resolveAlert(site.id, "drift_detected", "No stale pull requests or deployment lag.");
    return;
  }

  const reasons: string[] = [];
  if (stalePRs.length > 0) {
    reasons.push(`${stalePRs.length} PR(s) open ${STALE_PR_MS / 86_400_000}+ days without merging`);
  }
  if (deploymentPersistentlyBehind) {
    reasons.push(
      `production is ${recentRuns[0].deploymentCommitsBehind} commit(s) behind ${site.prodBranch}`,
    );
  }

  await openAlert({
    siteId: site.id,
    type: "drift_detected",
    severity: "warning",
    message: `${site.name}: ${reasons.join("; ")}`,
    relatedRunType: "drift_check_run",
    relatedRunId: latestRunId,
  });
}
