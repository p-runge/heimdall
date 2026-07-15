import { getIntegrationStatuses } from "@/lib/integrations";
import { Badge, Panel } from "@/components/ui";

export default function SettingsPage() {
  const integrations = getIntegrationStatuses();

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="font-display text-2xl tracking-wide text-mist-100">Integrations</h1>
      <p className="mt-2 max-w-xl text-mist-300">
        Features that depend on external credentials. Set the environment variables below and
        restart the app to enable them.
      </p>

      <div className="mt-8 space-y-3">
        {integrations.map((integration) => (
          <Panel key={integration.key}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-mist-100">{integration.name}</span>
                  <Badge tone={integration.configured ? "aurora" : "neutral"}>
                    {integration.configured ? "configured" : "not configured"}
                  </Badge>
                </div>
                <p className="mt-1.5 text-sm text-mist-400">{integration.description}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {integration.envVars.map((envVar) => (
                    <code
                      key={envVar}
                      className="rounded border border-mist-700 bg-void px-1.5 py-0.5 font-mono text-xs text-mist-400"
                    >
                      {envVar}
                    </code>
                  ))}
                </div>
              </div>
              <span
                aria-hidden
                className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                  integration.configured ? "bg-aurora-teal status-ring text-aurora-teal" : "bg-mist-700"
                }`}
              />
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}
