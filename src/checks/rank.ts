import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { keywords, rankCheckRuns, type sites } from "@/db/schema";
import { dataForSeoProvider } from "@/providers/dataforseo";
import type { RankProvider } from "@/providers/rankProvider";
import { openAlert, resolveAlert } from "@/lib/alerts";

const provider: RankProvider = dataForSeoProvider;

function domainOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export interface RankSubmitSummary {
  submitted: number;
  skipped: number;
  failed: { keyword: string; error: string }[];
}

export async function submitRankChecksForSite(
  site: typeof sites.$inferSelect,
): Promise<RankSubmitSummary> {
  const siteKeywords = await db.query.keywords.findMany({
    where: and(eq(keywords.siteId, site.id), eq(keywords.isActive, true)),
  });

  const domain = domainOf(site.primaryUrl);
  const summary: RankSubmitSummary = { submitted: 0, skipped: 0, failed: [] };
  if (siteKeywords.length === 0) return summary;

  // Keywords with a submit+poll task still in flight are skipped so a repeated
  // "run check now" click (or an overlap with the daily cron) doesn't pay for
  // duplicate provider tasks.
  const pendingRuns = await db
    .select({ keywordId: rankCheckRuns.keywordId })
    .from(rankCheckRuns)
    .where(
      and(
        inArray(
          rankCheckRuns.keywordId,
          siteKeywords.map((k) => k.id),
        ),
        sql`${rankCheckRuns.serpFeatures} ->> 'pending' = 'true'`,
      ),
    );
  const pendingKeywordIds = new Set(pendingRuns.map((r) => r.keywordId));

  for (const keyword of siteKeywords) {
    if (pendingKeywordIds.has(keyword.id)) {
      summary.skipped += 1;
      continue;
    }
    try {
      const { taskId } = await provider.submit({
        keyword: keyword.phrase,
        domain,
        country: keyword.country,
        device: keyword.device,
      });
      // serpFeatures temporarily holds { taskId, pending: true } until rank-poll
      // resolves it and overwrites it with the real SERP feature payload.
      await db.insert(rankCheckRuns).values({
        keywordId: keyword.id,
        provider: provider.name,
        position: null,
        rankedUrl: null,
        serpFeatures: { taskId, pending: true },
      });
      summary.submitted += 1;
    } catch (err) {
      console.error(`rank submit failed for keyword ${keyword.id}:`, err);
      summary.failed.push({
        keyword: keyword.phrase,
        error: err instanceof Error ? err.message : "unknown error",
      });
    }
  }

  return summary;
}

export async function pollPendingRankChecks() {
  const pending = await db.query.rankCheckRuns.findMany({
    where: sql`${rankCheckRuns.serpFeatures} ->> 'pending' = 'true'`,
    with: { keyword: { with: { site: true } } },
  });

  let resolved = 0;

  for (const run of pending) {
    const taskId = (run.serpFeatures as { taskId?: string } | null)?.taskId;
    if (!taskId) continue;

    try {
      const result = await provider.poll(taskId);
      if (!result) continue; // still processing, try again next tick

      await db
        .update(rankCheckRuns)
        .set({
          position: result.position,
          rankedUrl: result.rankedUrl,
          serpFeatures: result.serpFeatures ?? {},
        })
        .where(eq(rankCheckRuns.id, run.id));

      resolved += 1;
      await evaluateRankAlert(run.keyword, run.id, result.position);
    } catch (err) {
      console.error(`rank poll failed for task ${taskId}:`, err);
    }
  }

  return resolved;
}

async function evaluateRankAlert(
  keyword: typeof keywords.$inferSelect & { site: typeof sites.$inferSelect },
  latestRunId: string,
  newPosition: number | null,
) {
  const previous = await db.query.rankCheckRuns.findFirst({
    where: and(
      eq(rankCheckRuns.keywordId, keyword.id),
      ne(rankCheckRuns.id, latestRunId),
      isNotNull(rankCheckRuns.position),
    ),
    orderBy: desc(rankCheckRuns.checkedAt),
  });

  const droppedOut = previous?.position != null && newPosition == null;
  const worsened =
    previous?.position != null && newPosition != null && newPosition - previous.position > 5;

  if (droppedOut || worsened) {
    await openAlert({
      siteId: keyword.siteId,
      type: "rank_drop",
      severity: "warning",
      message: `"${keyword.phrase}" ${
        droppedOut ? "dropped out of the top 100" : `fell from #${previous?.position} to #${newPosition}`
      } for ${keyword.site.name}`,
      relatedRunType: "rank_check_run",
      relatedRunId: latestRunId,
    });
  } else if (previous?.position != null && newPosition != null && newPosition <= previous.position) {
    await resolveAlert(keyword.siteId, "rank_drop", "Ranking recovered.");
  }
}
