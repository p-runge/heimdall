import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { alerts, complianceCheckRuns, driftCheckRuns, healthCheckRuns, previewCheckRuns, rankCheckRuns, sites } from "@/db/schema";
import { runSiteChecks } from "@/checks/runAll";
import {
  createKeyword,
  deleteKeyword,
  deleteSite,
  runRankCheckNow,
  setSeoWatcher,
  updateSite,
} from "@/lib/actions";
import { isIntegrationConfigured } from "@/lib/integrations";
import { describeCronInterval, getNextRun } from "@/lib/cronSchedule";
import { Badge, Button, Callout, Field, Panel, TextInput } from "@/components/ui";
import { RankCheckButton } from "./RankCheckButton";
import { EditSiteForm } from "./EditSiteForm";

// DataForSEO's live endpoint (used by "run check now") can take longer than the
// platform's default Server Action timeout to resolve, especially with several keywords.
export const maxDuration = 60;

function daysSince(date: Date) {
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

export default async function SiteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Every check except the paid SEO/rank check runs on each visit to this page,
  // so the panels below always reflect current state rather than the last cron tick.
  const siteForChecks = await db.query.sites.findFirst({ where: eq(sites.id, id) });
  if (!siteForChecks) notFound();
  const { driftError } = await runSiteChecks(siteForChecks);

  const site = await db.query.sites.findFirst({
    where: eq(sites.id, id),
    with: {
      client: true,
      healthCheckRuns: { orderBy: desc(healthCheckRuns.checkedAt), limit: 1 },
      complianceCheckRuns: { orderBy: desc(complianceCheckRuns.checkedAt), limit: 1 },
      previewCheckRuns: { orderBy: desc(previewCheckRuns.checkedAt), limit: 1 },
      driftCheckRuns: {
        orderBy: desc(driftCheckRuns.checkedAt),
        limit: 1,
        with: { pullRequests: true },
      },
      keywords: {
        with: {
          rankCheckRuns: { orderBy: desc(rankCheckRuns.checkedAt), limit: 1 },
        },
      },
      alerts: { where: eq(alerts.status, "open") },
    },
  });

  if (!site) notFound();

  const deleteSiteWithIds = deleteSite.bind(null, site.id, site.clientId);
  const updateSiteWithId = updateSite.bind(null, site.id);
  const health = site.healthCheckRuns[0];
  const compliance = site.complianceCheckRuns[0];
  const preview = site.previewCheckRuns[0];
  const drift = site.driftCheckRuns[0];
  const STALE_PR_DAYS = 3;
  const githubConfigured = isIntegrationConfigured("github");
  const dataforseoConfigured = isIntegrationConfigured("dataforseo");
  const setSeoWatcherWithIds = setSeoWatcher.bind(null, site.id, site.seoWatcherEnabled);
  const runRankCheckNowWithIds = runRankCheckNow.bind(null, site.id);
  const rankSubmitInterval = describeCronInterval("/api/cron/rank-submit");
  const nextRankCheck = site.seoWatcherEnabled ? getNextRun("/api/cron/rank-submit") : null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex items-start justify-between">
        <div>
          <Link
            href={`/clients/${site.clientId}`}
            className="text-sm text-mist-500 hover:text-mist-300"
          >
            &larr; {site.client.name}
          </Link>
          <EditSiteForm site={site} action={updateSiteWithId} />
        </div>
        <form action={deleteSiteWithIds}>
          <Button variant="danger" type="submit">
            Delete site
          </Button>
        </form>
      </div>

      {site.alerts.length > 0 && (
        <div className="mt-6 space-y-2">
          {site.alerts.map((alert) => (
            <div
              key={alert.id}
              className={`bifrost-border rounded-lg border px-4 py-3 text-sm ${
                alert.severity === "critical"
                  ? "border-crimson/40 bg-crimson/5 text-crimson"
                  : "border-horn-gold/40 bg-horn-gold/5 text-horn-gold"
              }`}
            >
              {alert.message}
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Panel>
          <h2 className="font-display text-sm tracking-wide text-mist-300">Health</h2>
          {health ? (
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Badge tone={health.isUp ? "aurora" : "crimson"}>
                  {health.isUp ? "up" : "down"}
                </Badge>
                {health.httpStatus && (
                  <span className="text-mist-500">HTTP {health.httpStatus}</span>
                )}
                <span className="text-mist-500">{health.responseTimeMs}ms</span>
              </div>
              {health.tlsDaysRemaining != null && (
                <div className="text-mist-400">
                  TLS cert expires in{" "}
                  <span className={health.tlsDaysRemaining < 14 ? "text-horn-gold" : "text-mist-200"}>
                    {health.tlsDaysRemaining} day(s)
                  </span>
                </div>
              )}
              {health.seoIssues && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {health.seoIssues.missingTitle && <Badge tone="gold">missing title</Badge>}
                  {health.seoIssues.missingMetaDescription && (
                    <Badge tone="gold">missing meta description</Badge>
                  )}
                  {health.seoIssues.missingCanonical && <Badge tone="gold">missing canonical</Badge>}
                  {health.seoIssues.mixedContent && <Badge tone="crimson">mixed content</Badge>}
                </div>
              )}
              <div className="text-xs text-mist-600">
                checked {health.checkedAt.toLocaleString()}
              </div>
            </div>
          ) : (
            <p className="mt-2 text-mist-500">No checks yet.</p>
          )}
        </Panel>

        <Panel>
          <h2 className="font-display text-sm tracking-wide text-mist-300">Deploy drift</h2>
          {site.githubOwner && site.githubRepo ? (
            !githubConfigured ? (
              <div className="mt-3">
                <Callout>
                  GitHub isn&apos;t connected, so drift checks aren&apos;t running.{" "}
                  <Link href="/settings" className="underline hover:text-mist-100">
                    Configure it
                  </Link>
                  .
                </Callout>
              </div>
            ) : driftError ? (
              <div className="mt-3">
                <Callout tone="crimson">The last drift check failed: {driftError}</Callout>
              </div>
            ) : drift ? (
              <div className="mt-3 space-y-2 text-sm">
                {drift.deploymentSha != null ? (
                  <Badge tone={(drift.deploymentCommitsBehind ?? 0) > 0 ? "gold" : "aurora"}>
                    {(drift.deploymentCommitsBehind ?? 0) > 0
                      ? `${drift.deploymentCommitsBehind} commit(s) behind latest deploy`
                      : "deployment in sync"}
                  </Badge>
                ) : (
                  <div className="text-xs text-mist-600">No deployment data available.</div>
                )}
                {drift.pullRequests.length === 0 ? (
                  <p className="text-mist-500">No open pull requests pending.</p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {drift.pullRequests.map((pr) => {
                      const daysOpen = daysSince(pr.prCreatedAt);
                      return (
                        <li key={pr.id} className="flex items-center gap-2 text-mist-400">
                          <a
                            href={pr.url}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-mist-100"
                          >
                            #{pr.number} {pr.title}
                          </a>
                          {daysOpen >= STALE_PR_DAYS && (
                            <Badge tone="gold">open {daysOpen}d</Badge>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="text-xs text-mist-600">
                  checked {drift.checkedAt.toLocaleString()}
                </div>
              </div>
            ) : (
              <p className="mt-2 text-mist-500">No checks yet.</p>
            )
          ) : (
            <p className="mt-2 text-mist-500">No repository configured.</p>
          )}
        </Panel>

        <Panel>
          <h2 className="font-display text-sm tracking-wide text-mist-300">Compliance</h2>
          {compliance ? (
            <div className="mt-3 flex flex-wrap gap-1.5 text-sm">
              <Badge tone={compliance.impressumFound ? "aurora" : "crimson"}>
                {compliance.impressumFound ? "impressum found" : "no impressum"}
              </Badge>
              <Badge tone={compliance.privacyPolicyFound ? "aurora" : "crimson"}>
                {compliance.privacyPolicyFound ? "privacy policy found" : "no privacy policy"}
              </Badge>
              {compliance.cookieConsentToolDetected && (
                <Badge tone="aurora">{compliance.cookieConsentTool}</Badge>
              )}
              {compliance.unconsentedGoogleFontsDetected && (
                <Badge tone="gold">unconsented Google Fonts</Badge>
              )}
              <div className="w-full text-xs text-mist-600 mt-1">
                Heuristic signals, not legal advice.
              </div>
            </div>
          ) : (
            <p className="mt-2 text-mist-500">No checks yet.</p>
          )}
        </Panel>

        <Panel>
          <h2 className="font-display text-sm tracking-wide text-mist-300">
            Preview environment
          </h2>
          {site.previewUrl ? (
            preview ? (
              <div className="mt-3 flex flex-wrap gap-1.5 text-sm">
                <Badge tone={preview.isPasswordProtected ? "aurora" : "crimson"}>
                  {preview.isPasswordProtected ? "password protected" : "not protected"}
                </Badge>
                <Badge tone={preview.hasNoIndexTag ? "aurora" : "gold"}>
                  {preview.hasNoIndexTag ? "noindex" : "indexable"}
                </Badge>
                {preview.isPubliclyExposed && <Badge tone="crimson">publicly exposed</Badge>}
              </div>
            ) : (
              <p className="mt-2 text-mist-500">No checks yet.</p>
            )
          ) : (
            <p className="mt-2 text-mist-500">Not configured.</p>
          )}
        </Panel>
      </div>

      <div className="mt-8">
        <Panel className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-sm tracking-wide text-mist-300">SEO watcher</h2>
              <Badge tone={site.seoWatcherEnabled ? "aurora" : "neutral"}>
                {site.seoWatcherEnabled ? "watching" : "paused"}
              </Badge>
            </div>
            <div className="mt-2 text-sm text-mist-400">
              {site.seoWatcherEnabled ? (
                <>
                  Automatic rank checks run{" "}
                  {rankSubmitInterval ?? "on schedule"}
                  {nextRankCheck && (
                    <> &middot; next check {nextRankCheck.toLocaleString()}</>
                  )}
                  .
                </>
              ) : (
                "Automatic rank checks are off — DataForSEO calls cost money per keyword, so this stays opt-in per site."
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <RankCheckButton action={runRankCheckNowWithIds} disabled={!dataforseoConfigured} />
            <form action={setSeoWatcherWithIds}>
              <Button variant={site.seoWatcherEnabled ? "danger" : "primary"} type="submit">
                {site.seoWatcherEnabled ? "Turn off" : "Turn on"}
              </Button>
            </form>
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-8 md:grid-cols-[2fr_1fr]">
        <div>
          <h2 className="font-display text-lg tracking-wide text-mist-100">Keywords</h2>
          {!dataforseoConfigured && (
            <div className="mt-3">
              <Callout>
                SEO rank tracking isn&apos;t connected — keywords can be added, but positions won&apos;t
                update until it is.{" "}
                <Link href="/settings" className="underline hover:text-mist-100">
                  Configure it
                </Link>
                .
              </Callout>
            </div>
          )}
          <div className="mt-3 space-y-2">
            {site.keywords.length === 0 && (
              <Panel className="text-mist-500">No keywords tracked yet.</Panel>
            )}
            {site.keywords.map((keyword) => {
              const latestRank = keyword.rankCheckRuns[0];
              // A run created by the async submit+poll cron flow starts as
              // { pending: true } in serpFeatures and is only overwritten once
              // rank-poll resolves it — until then it's still in progress, not "not ranking".
              const isChecking =
                !!latestRank &&
                (latestRank.serpFeatures as { pending?: boolean } | null)?.pending === true;
              const deleteKeywordWithIds = deleteKeyword.bind(null, keyword.id, site.id);

              let label: string;
              let tone: "neutral" | "gold" | "crimson" | "aurora";
              if (!latestRank) {
                label = "not checked yet";
                tone = "neutral";
              } else if (isChecking) {
                label = "checking…";
                tone = "gold";
              } else if (latestRank.position) {
                label = `#${latestRank.position}`;
                tone = "aurora";
              } else {
                label = "not ranking";
                tone = "neutral";
              }

              return (
                <Panel key={keyword.id} className="flex items-center justify-between">
                  <div>
                    <div className="text-mist-100">{keyword.phrase}</div>
                    <div className="text-xs text-mist-500">
                      {keyword.country.toUpperCase()} &middot; {keyword.device}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={tone} title={latestRank ? `checked ${latestRank.checkedAt.toLocaleString()}` : undefined}>
                      {label}
                    </Badge>
                    <form action={deleteKeywordWithIds}>
                      <Button variant="ghost" type="submit" className="px-2 py-1 text-xs">
                        remove
                      </Button>
                    </form>
                  </div>
                </Panel>
              );
            })}
          </div>
        </div>

        <Panel>
          <h2 className="font-display text-lg tracking-wide text-mist-100">Track keyword</h2>
          <form action={createKeyword} className="mt-4 flex flex-col gap-4">
            <input type="hidden" name="siteId" value={site.id} />
            <Field label="Phrase">
              <TextInput name="phrase" required placeholder="best coffee berlin" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Country">
                <TextInput name="country" defaultValue="de" placeholder="de" />
              </Field>
              <Field label="Device">
                <select
                  name="device"
                  defaultValue="desktop"
                  className="rounded-md border border-mist-700 bg-void px-3 py-2 text-sm text-mist-100 outline-none focus:border-aurora-violet"
                >
                  <option value="desktop">Desktop</option>
                  <option value="mobile">Mobile</option>
                </select>
              </Field>
            </div>
            <Button type="submit">Add keyword</Button>
          </form>
        </Panel>
      </div>
    </div>
  );
}
