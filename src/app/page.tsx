import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { alerts, sites } from "@/db/schema";
import { Badge } from "@/components/ui";

type SiteStatus = "critical" | "warning" | "healthy";

const STATUS_RANK: Record<SiteStatus, number> = { critical: 0, warning: 1, healthy: 2 };

const STATUS_STYLES: Record<SiteStatus, { ring: string; dot: string; label: string }> = {
  critical: { ring: "text-crimson", dot: "bg-crimson", label: "critical" },
  warning: { ring: "text-horn-gold", dot: "bg-horn-gold", label: "warning" },
  healthy: { ring: "text-aurora-teal", dot: "bg-aurora-teal", label: "healthy" },
};

function siteStatus(openAlerts: { severity: string }[]): SiteStatus {
  if (openAlerts.some((a) => a.severity === "critical")) return "critical";
  if (openAlerts.some((a) => a.severity === "warning")) return "warning";
  return "healthy";
}

export default async function Home() {
  const activeSites = await db.query.sites.findMany({
    where: eq(sites.isActive, true),
    with: {
      client: true,
      alerts: { where: eq(alerts.status, "open") },
    },
  });

  const watchposts = activeSites
    .map((site) => ({ site, status: siteStatus(site.alerts) }))
    .sort(
      (a, b) =>
        STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.site.name.localeCompare(b.site.name),
    );

  const activeAlertCount = activeSites.reduce((sum, site) => sum + site.alerts.length, 0);
  const auroraIntensity = Math.min(0.1 + activeAlertCount * 0.04, 0.4);

  return (
    <div className="relative overflow-hidden">
      <div
        className="aurora-ambient"
        style={{ "--aurora-intensity": auroraIntensity } as React.CSSProperties}
      />
      <div className="relative mx-auto max-w-6xl px-6 py-16">
        <h1 className="font-display text-3xl tracking-wide text-mist-100">
          The <span className="aurora-text">Watchtower</span>
        </h1>
        <p className="mt-3 max-w-xl text-mist-300">
          {watchposts.length === 0
            ? "Nothing under watch yet. Add a client and a site to begin."
            : `Keeping watch over ${watchposts.length} site${watchposts.length === 1 ? "" : "s"}.`}
        </p>

        {watchposts.length > 0 && (
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {watchposts.map(({ site, status }) => {
              const styles = STATUS_STYLES[status];
              return (
                <Link key={site.id} href={`/sites/${site.id}`}>
                  <div className="rounded-xl border border-mist-800/70 bg-void-panel/60 p-5 transition-colors hover:border-mist-600">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-mist-100">{site.name}</div>
                        <div className="truncate text-sm text-mist-500">{site.client.name}</div>
                      </div>
                      <span
                        className={`status-ring mt-1 h-3 w-3 shrink-0 rounded-full ${styles.dot} ${styles.ring}`}
                        aria-hidden
                      />
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      <span className="truncate text-sm text-mist-500">
                        {site.primaryUrl.replace(/^https?:\/\//, "")}
                      </span>
                      <Badge
                        tone={
                          status === "critical" ? "crimson" : status === "warning" ? "gold" : "aurora"
                        }
                      >
                        {styles.label}
                      </Badge>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {watchposts.length === 0 && (
          <Link
            href="/clients"
            className="mt-8 inline-flex rounded-md border border-mist-700 px-4 py-2 text-sm text-mist-100 hover:border-mist-500"
          >
            Go to Clients &rarr;
          </Link>
        )}
      </div>
    </div>
  );
}
