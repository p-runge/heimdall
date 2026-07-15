import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { alerts, complianceCheckRuns, driftCheckRuns, healthCheckRuns, previewCheckRuns, rankCheckRuns, sites } from "@/db/schema";
import { createKeyword, deleteKeyword, deleteSite } from "@/lib/actions";
import { Badge, Button, Field, Panel, TextInput } from "@/components/ui";

export default async function SiteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const site = await db.query.sites.findFirst({
    where: eq(sites.id, id),
    with: {
      client: true,
      environmentBranchMappings: true,
      healthCheckRuns: { orderBy: desc(healthCheckRuns.checkedAt), limit: 1 },
      complianceCheckRuns: { orderBy: desc(complianceCheckRuns.checkedAt), limit: 1 },
      previewCheckRuns: { orderBy: desc(previewCheckRuns.checkedAt), limit: 1 },
      driftCheckRuns: {
        orderBy: desc(driftCheckRuns.checkedAt),
        limit: 1,
        with: { commits: true },
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
  const health = site.healthCheckRuns[0];
  const compliance = site.complianceCheckRuns[0];
  const preview = site.previewCheckRuns[0];
  const drift = site.driftCheckRuns[0];

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
          <h1 className="mt-2 font-display text-2xl tracking-wide text-mist-100">
            {site.name}
          </h1>
          <a
            href={site.primaryUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block text-mist-400 hover:text-aurora-teal"
          >
            {site.primaryUrl}
          </a>
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
            drift ? (
              <div className="mt-3 space-y-2 text-sm">
                <Badge tone={drift.commitsBehind > 0 ? "gold" : "aurora"}>
                  {drift.commitsBehind > 0 ? `${drift.commitsBehind} undeployed commit(s)` : "in sync"}
                </Badge>
                <ul className="mt-2 space-y-1">
                  {drift.commits.map((commit) => (
                    <li key={commit.id} className="text-mist-400">
                      <span className="font-mono text-xs text-mist-600">
                        {commit.sha.slice(0, 7)}
                      </span>{" "}
                      {commit.message.split("\n")[0]}
                    </li>
                  ))}
                </ul>
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

      <div className="mt-4 grid gap-8 md:grid-cols-[2fr_1fr]">
        <div>
          <h2 className="font-display text-lg tracking-wide text-mist-100">Keywords</h2>
          <div className="mt-3 space-y-2">
            {site.keywords.length === 0 && (
              <Panel className="text-mist-500">No keywords tracked yet.</Panel>
            )}
            {site.keywords.map((keyword) => {
              const latestRank = keyword.rankCheckRuns[0];
              const deleteKeywordWithIds = deleteKeyword.bind(null, keyword.id, site.id);
              return (
                <Panel key={keyword.id} className="flex items-center justify-between">
                  <div>
                    <div className="text-mist-100">{keyword.phrase}</div>
                    <div className="text-xs text-mist-500">
                      {keyword.country.toUpperCase()} &middot; {keyword.device}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {latestRank ? (
                      <Badge tone={latestRank.position ? "aurora" : "neutral"}>
                        {latestRank.position ? `#${latestRank.position}` : "not ranking"}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">pending</Badge>
                    )}
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
