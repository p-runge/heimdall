import type { securityHeaderCheckRuns, siteSecurityHeaderExpectations } from "@/db/schema";
import { disableSecurityProtection, monitorSecurityProtection } from "@/lib/actions";
import {
  BASE_PROTECTIONS,
  SECURITY_HEADER_NAMES,
  describeProtection,
  summarizeProtections,
  type ProtectionState,
} from "@/lib/security-headers";
import { Badge, Panel, TextInput } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

type Run = typeof securityHeaderCheckRuns.$inferSelect;
type ExpectationRow = typeof siteSecurityHeaderExpectations.$inferSelect;

const STATE_TONES: Record<ProtectionState, "aurora" | "crimson" | "gold" | "neutral"> = {
  present: "aurora",
  lost: "crimson",
  missing: "neutral",
  disabled: "neutral",
  disabled_present: "neutral",
};

const STATE_SUFFIXES: Partial<Record<ProtectionState, string>> = {
  lost: "lost",
  missing: "not set",
  disabled: "disabled",
  disabled_present: "disabled, present again",
};

const HEADER_LABELS: Record<(typeof SECURITY_HEADER_NAMES)[number], string> = {
  "strict-transport-security": "Strict-Transport-Security",
  "x-content-type-options": "X-Content-Type-Options",
  "x-frame-options": "X-Frame-Options",
  "referrer-policy": "Referrer-Policy",
  "content-security-policy": "Content-Security-Policy",
  "permissions-policy": "Permissions-Policy",
};

function MonitorAgainButton({ siteId, protectionKey }: { siteId: string; protectionKey: string }) {
  return (
    <form action={monitorSecurityProtection.bind(null, siteId, protectionKey)}>
      <SubmitButton variant="ghost" className="px-2.5 py-1 text-xs" pendingText="Saving…">
        Monitor again
      </SubmitButton>
    </form>
  );
}

export function SecurityHeadersPanel({
  siteId,
  run,
  expectations,
}: {
  siteId: string;
  run: Run | undefined;
  expectations: ExpectationRow[];
}) {
  const base: string[] = BASE_PROTECTIONS;
  const disabledRows = expectations
    .filter((e) => e.status === "disabled")
    .sort((a, b) => a.protectionKey.localeCompare(b.protectionKey));
  const states = run ? summarizeProtections(run.protections, expectations) : [];
  const lost = states.filter((s) => s.state === "lost");
  const presentAgain = states.filter((s) => s.state === "disabled_present");

  return (
    <Panel>
      <h2 className="font-display text-sm tracking-wide text-mist-300">Security headers</h2>

      {disabledRows.length > 0 && (
        <div className="mt-3">
          <h3 className="text-xs uppercase tracking-wide text-mist-500">Disabled for this site</h3>
          <ul className="mt-1.5 space-y-1.5 text-sm">
            {disabledRows.map((row) => (
              <li key={row.id} className="flex items-start justify-between gap-3">
                <div>
                  <span className="text-mist-100">{describeProtection(row.protectionKey)}</span>
                  <span className="text-xs text-mist-500">
                    {" · "}
                    {row.disabledAt?.toLocaleDateString()}
                    {row.disabledBy && ` · ${row.disabledBy}`}
                  </span>
                  {row.disabledNote && (
                    <div className="text-xs text-mist-400">{row.disabledNote}</div>
                  )}
                </div>
                <MonitorAgainButton siteId={siteId} protectionKey={row.protectionKey} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {!run ? (
        <p className="mt-2 text-mist-500">No checks yet.</p>
      ) : (
        <>
          {lost.length > 0 && (
            <ul className="mt-3 space-y-2">
              {lost.map(({ key }) => (
                <li key={key}>
                  <form
                    action={disableSecurityProtection.bind(null, siteId, key)}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <Badge tone="crimson">{describeProtection(key)} lost</Badge>
                    <TextInput
                      name="note"
                      placeholder="Why is this intended? (optional)"
                      className="min-w-0 flex-1 py-1 text-xs"
                    />
                    <SubmitButton
                      variant="ghost"
                      className="px-2.5 py-1 text-xs"
                      pendingText="Saving…"
                    >
                      Disable for this site
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}

          {presentAgain.length > 0 && (
            <ul className="mt-3 space-y-1.5 text-sm">
              {presentAgain.map(({ key }) => (
                <li key={key} className="flex items-center justify-between gap-3">
                  <Badge tone="neutral">{describeProtection(key)} disabled, present again</Badge>
                  <MonitorAgainButton siteId={siteId} protectionKey={key} />
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {states
              .filter((s) => s.state !== "lost" && s.state !== "disabled_present")
              .map(({ key, state }) => {
                const tone = state === "missing" && base.includes(key) ? "gold" : STATE_TONES[state];
                const suffix = STATE_SUFFIXES[state];
                return (
                  <Badge key={key} tone={tone}>
                    {describeProtection(key)}
                    {suffix && ` ${suffix}`}
                  </Badge>
                );
              })}
          </div>

          <dl className="mt-4 space-y-1 text-xs">
            {SECURITY_HEADER_NAMES.map((name) => {
              const value = run.headers[name];
              return (
                <div key={name} className="grid grid-cols-[minmax(0,12rem)_1fr] gap-2">
                  <dt className="text-mist-500">{HEADER_LABELS[name]}</dt>
                  <dd className="min-w-0 break-words font-mono text-mist-300">
                    {value === undefined ? (
                      <span className="text-mist-600">not set</span>
                    ) : name === "content-security-policy" ? (
                      <details>
                        <summary className="cursor-pointer truncate">{value}</summary>
                        <div className="mt-1 whitespace-pre-wrap">
                          {value
                            .split(";")
                            .map((directive) => directive.trim())
                            .join(";\n")}
                        </div>
                      </details>
                    ) : (
                      value
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>

          <div className="mt-3 text-xs text-mist-600">
            checked {run.checkedAt.toLocaleString()} · {run.finalUrl}
          </div>
        </>
      )}
    </Panel>
  );
}
