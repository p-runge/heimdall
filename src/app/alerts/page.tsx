import Link from "next/link";
import { desc, ne } from "drizzle-orm";
import { db } from "@/db";
import { alerts } from "@/db/schema";
import { acknowledgeAlert, resolveAlertManually } from "@/lib/actions";
import { isIntegrationConfigured } from "@/lib/integrations";
import { Badge, Callout, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

const TYPE_LABELS: Record<string, string> = {
  site_down: "Site down",
  cert_expiring: "Certificate expiring",
  seo_issue: "SEO issue",
  drift_detected: "Deploy drift",
  rank_drop: "Rank drop",
  lighthouse_regression: "Lighthouse regression",
  preview_exposed: "Preview exposed",
  compliance_issue: "Compliance issue",
};

export default async function AlertsPage() {
  const allAlerts = await db.query.alerts.findMany({
    where: ne(alerts.status, "resolved"),
    orderBy: desc(alerts.createdAt),
    with: { site: true },
  });
  const discordConfigured = isIntegrationConfigured("discord");

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="font-display text-2xl tracking-wide text-mist-100">
        <span className="aurora-text">Gjallarhorn</span> Alerts
      </h1>
      <p className="mt-2 text-mist-300">Everything the horn has sounded that isn&apos;t resolved yet.</p>

      {!discordConfigured && (
        <div className="mt-4">
          <Callout tone="neutral">
            Discord notifications aren&apos;t connected — alerts only show up here.{" "}
            <Link href="/settings" className="underline hover:text-mist-100">
              Configure it
            </Link>
            .
          </Callout>
        </div>
      )}

      <div className="mt-8 space-y-3">
        {allAlerts.length === 0 && <Panel className="text-mist-500">All quiet.</Panel>}
        {allAlerts.map((alert) => {
          const acknowledgeWithId = acknowledgeAlert.bind(null, alert.id);
          const resolveWithId = resolveAlertManually.bind(null, alert.id);
          return (
            <Panel
              key={alert.id}
              className={alert.severity === "critical" ? "bifrost-border" : ""}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge tone={alert.severity === "critical" ? "crimson" : "gold"}>
                      {TYPE_LABELS[alert.type] ?? alert.type}
                    </Badge>
                    {alert.status === "acknowledged" && <Badge tone="neutral">acknowledged</Badge>}
                    <Link
                      href={`/sites/${alert.siteId}`}
                      className="text-sm text-mist-400 hover:text-mist-100"
                    >
                      {alert.site.name}
                    </Link>
                  </div>
                  <p className="mt-2 text-mist-100">{alert.message}</p>
                  <p className="mt-1 text-xs text-mist-600">
                    opened {alert.createdAt.toLocaleString()}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {alert.status === "open" && (
                    <form action={acknowledgeWithId}>
                      <SubmitButton variant="ghost" pendingText="Acknowledging…">
                        Acknowledge
                      </SubmitButton>
                    </form>
                  )}
                  <form action={resolveWithId}>
                    <SubmitButton variant="ghost" pendingText="Resolving…">
                      Resolve
                    </SubmitButton>
                  </form>
                </div>
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
