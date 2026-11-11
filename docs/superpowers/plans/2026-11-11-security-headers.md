# Security Header Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Check each active site's response security headers daily, alert when a protection the site used to have is lost, and show headers plus per-site disabled protections on the site page.

**Architecture:** A pure module (`src/lib/security-headers.ts`) turns raw headers into protection keys and compares them with per-site expectations. A check (`src/checks/security-headers.ts`) fetches the site, stores a run, grows the expectations and reconciles one alert per site. Server actions disable or re-monitor protections, and the site page renders a new panel.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` before touching routes or server actions), Drizzle ORM + Postgres, `node:test` via `tsx`, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-10-security-headers-design.md`

## Global Constraints

- Work in a git worktree, not the main checkout (`EnterWorktree` if the session did not start in one).
- All code, comments and identifiers in English. Comments describe the code as it is, never the task or session.
- Commits: only after the user explicitly approves each one. One-line Conventional Commit subject (`feat(security-headers): …`), no body, no `Co-Authored-By` or session trailer.
- Never print `.env*` values; run anything needing `DATABASE_URL` through `~/.claude/scripts/envrun -f .env.local '<cmd>'`.
- Verification servers use `$PORT` only; track the PID via `$!` and `kill <PID>`. Load the `verify-with-dev-server` skill before starting one.
- New alert type value: `security_header_regression`, label `"Security header regression"`, ntfy tags `["shield"]`, priority `{ warning: "default", critical: "high" }`.
- Cron: `{ "path": "/api/cron/security-headers", "schedule": "0 4 * * *" }`.
- Only 2xx final responses are evaluated; anything else stores nothing and changes nothing.
- `hsts` and `framing` regressions are critical; every other regression is warning.
- No alert ever for a protection that was never seen.

## Review Focus

- Header values with odd casing or whitespace (`NoSniff `, `max-age="31536000"; includeSubDomains`, `sameorigin`) must evaluate as protected. Test in Task 1.
- A redirect chain ending on `http:` must not count HSTS even if the header is present. Test in Task 1.
- An unreachable site, a 4xx WAF page or a 5xx error page must not look like "every header vanished". Test of `isEvaluableStatus` in Task 1; manual check in Task 3.
- Acknowledging the alert must not lead to a duplicate alert and a fresh push on the next run. Manual check in Task 3.
- A site that never sent any header produces no alert, while its page still shows the four base protections as missing. Tests in Task 1 (`compareWithExpectations`, `summarizeProtections`).

---

### Task 1: Pure evaluation module

**Files:**
- Create: `src/lib/security-headers.ts`
- Test: `src/lib/security-headers.test.ts` (style: `src/lib/fetch-error.test.ts`)

**Interfaces:**
- Produces:
  - `SECURITY_HEADER_NAMES = ["strict-transport-security", "x-content-type-options", "x-frame-options", "referrer-policy", "content-security-policy", "permissions-policy"] as const`
  - `type SecurityHeaderName = (typeof SECURITY_HEADER_NAMES)[number]`
  - `type RawSecurityHeaders = Partial<Record<SecurityHeaderName, string>>`
  - `type ProtectionKey = "hsts" | "nosniff" | "framing" | "referrer_policy" | "permissions_policy" | \`csp:${string}\``
  - `BASE_PROTECTIONS: ProtectionKey[] = ["hsts", "nosniff", "framing", "referrer_policy"]`
  - `type ExpectationStatus = "expected" | "disabled"`
  - `interface Expectation { protectionKey: string; status: ExpectationStatus }`
  - `type ProtectionState = "present" | "missing" | "lost" | "disabled" | "disabled_present"`
  - `pickSecurityHeaders(headers: Headers): RawSecurityHeaders`
  - `parseCspDirectives(value: string | undefined): Map<string, string[]>`
  - `evaluateProtections(headers: RawSecurityHeaders, finalUrl: string): ProtectionKey[]` (sorted, unique)
  - `isEvaluableStatus(status: number): boolean`
  - `compareWithExpectations(present: ProtectionKey[], expectations: Expectation[]): { newlyExpected: ProtectionKey[]; regressions: ProtectionKey[] }`
  - `regressionSeverity(regressions: ProtectionKey[]): "warning" | "critical"`
  - `describeProtection(key: string): string`: `hsts` → "HSTS", `nosniff` → "X-Content-Type-Options: nosniff", `framing` → "Framing protection", `referrer_policy` → "Referrer-Policy", `permissions_policy` → "Permissions-Policy", `csp:<d>` → "CSP <d>"
  - `describeRegressions(siteName: string, regressions: ProtectionKey[]): string`: `` `${siteName}: lost ${labels.join(", ")}` ``
  - `summarizeProtections(present: ProtectionKey[], expectations: Expectation[]): { key: string; state: ProtectionState }[]`

- [ ] **Step 1: Write the failing tests**

`parseCspDirectives`:
- `"default-src 'self'; frame-ancestors 'none'"` → keys `default-src`, `frame-ancestors`; `frame-ancestors` → `["'none'"]`
- directive names are lowercased; empty and whitespace-only segments are skipped; `undefined` and `""` → empty map
- two policies joined by `", "` (`"script-src 'self', frame-ancestors 'self'"`) → both directives present
- a directive repeated in one policy keeps the first occurrence's sources

`evaluateProtections` (finalUrl `https://example.com/` unless stated):
- the SNB header set from the spec survey → `["csp:base-uri", "csp:connect-src", "csp:default-src", "csp:font-src", "csp:form-action", "csp:frame-ancestors", "csp:img-src", "csp:object-src", "csp:script-src", "csp:style-src", "csp:upgrade-insecure-requests", "framing", "hsts", "nosniff", "permissions_policy", "referrer_policy"]`
- `{}` → `[]`
- HSTS `max-age=0` → no `hsts`; `max-age="31536000"; includeSubDomains` → `hsts`; valid HSTS with finalUrl `http://example.com/` → no `hsts`
- `x-content-type-options: "NoSniff "` → `nosniff`; `"foo"` → none
- XFO `DENY`, `sameorigin` → `framing`; `ALLOW-FROM https://a.example` → none
- CSP `frame-ancestors 'self'` → `framing` and `csp:frame-ancestors`; `frame-ancestors *` → `csp:frame-ancestors` but no `framing`; `frame-ancestors` with no sources → `framing`
- `referrer-policy: unsafe-url` → none; `no-referrer` → `referrer_policy`
- `permissions-policy: camera=()` → `permissions_policy`

`isEvaluableStatus`: `200`, `204` → true; `301`, `403`, `404`, `503` → false.

`compareWithExpectations`:
- no expectations, present `["nosniff"]` → `newlyExpected ["nosniff"]`, `regressions []`
- no expectations, present `[]` → both empty (a site without headers never alerts)
- expected `hsts`, present `[]` → `regressions ["hsts"]`
- disabled `hsts`, present `[]` → `regressions []`; disabled `hsts`, present `["hsts"]` → neither newly expected nor regressed

`regressionSeverity`: `["nosniff"]` → warning; `["csp:frame-ancestors"]` → warning; `["nosniff", "framing"]` → critical; `["hsts"]` → critical.

`summarizeProtections`:
- present `[]`, expectations `[]` → exactly the four base keys, all `missing`
- expected `csp:script-src` absent → `lost`; disabled `hsts` absent → `disabled`; disabled `hsts` present → `disabled_present`; present without row → `present`
- order: base keys first in `BASE_PROTECTIONS` order, then other keys sorted

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm exec tsx --test src/lib/security-headers.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/lib/security-headers.ts`**

`pickSecurityHeaders` reads each name in `SECURITY_HEADER_NAMES` via `headers.get` and omits nulls. `Content-Security-Policy-Report-Only` is never read. CSP parsing splits policies on `,` and directives on `;`. The first whitespace-separated token is the name, the rest are its sources. `max-age` is parsed with surrounding quotes stripped.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm test`
Expected: all tests pass, including the existing `fetch-error` tests.

- [ ] **Step 5: Commit (after user approval)**

`feat(security-headers): evaluate response headers into protections`

---

### Task 2: Schema, migration and alert type

**Files:**
- Modify: `src/db/schema.ts` (enum at line 25, tables after `complianceCheckRuns`, `sitesRelations`)
- Modify: `src/lib/alerts.ts` (`ALERT_TYPE_LABELS`, `NTFY_ALERT_STYLES`, export the notify fan-out)
- Create: `drizzle/0007_*.sql` + meta snapshot (generated)

**Interfaces:**
- Consumes: `RawSecurityHeaders`, `ProtectionKey`, `ExpectationStatus` from Task 1
- Produces:
  - `alertTypeEnum` gains `"security_header_regression"`
  - `securityHeaderExpectationStatusEnum = pgEnum("security_header_expectation_status", ["expected", "disabled"])`
  - table `siteSecurityHeaderExpectations` (`site_security_header_expectations`): `id` uuid pk, `siteId` fk → sites cascade, `protectionKey` text not null, `status` enum not null, `firstSeenAt` timestamp default now, `updatedAt` timestamp default now, `disabledAt` timestamp null, `disabledBy` text null (user email), `disabledNote` text null; `unique(siteId, protectionKey)`
  - table `securityHeaderCheckRuns` (`security_header_check_runs`): `id`, `siteId` fk cascade, `checkedAt` default now, `finalUrl` text not null, `httpStatus` integer not null, `headers` jsonb `$type<RawSecurityHeaders>()` not null, `protections` jsonb `$type<ProtectionKey[]>()` not null
  - relations: `sites.securityHeaderCheckRuns` (many), `sites.securityHeaderExpectations` (many), plus the `one(sites)` side of each
  - `export async function notifyAlert(type: AlertType, message: string, severity: AlertSeverity): Promise<void>`: the existing private `notify`, renamed and exported. `openAlert` calls it.
  - `export type AlertType`, `export type AlertSeverity` (currently file-local)

- [ ] **Step 1: Edit schema and `alerts.ts`**

The new `NTFY_ALERT_STYLES` entry gets a comment in the style of its neighbours: a protection the site used to send is gone; HSTS and framing are critical because they are what attackers exploit first, and the rest wait for the workday.

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate --name security_headers`
Expected: `drizzle/0007_security_headers.sql` containing `ALTER TYPE "public"."alert_type" ADD VALUE 'security_header_regression'`, the new enum and both tables.

- [ ] **Step 3: Apply locally and typecheck**

Run: `~/.claude/scripts/envrun -f .env.local 'pnpm db:migrate'`, then `pnpm exec tsc --noEmit`
Expected: migration applied; no type errors. `Record<AlertType, …>` forces both maps to have the new key.

- [ ] **Step 4: Commit (after user approval)**

`feat(security-headers): add check runs, expectations and alert type`

---

### Task 3: Check, cron route and live run on the site page

**Files:**
- Create: `src/checks/security-headers.ts`
- Create: `src/app/api/cron/security-headers/route.ts` (copy of `/api/cron/compliance/route.ts` calling the new check)
- Modify: `crons.json`
- Modify: `src/checks/runAll.ts` (Site type, throttle, `Promise.allSettled` list, `ranAnyCheck`)
- Modify: `src/app/sites/[id]/page.tsx` `getSiteDetail` (add `securityHeaderCheckRuns: { orderBy: desc(checkedAt), limit: 1 }` and `securityHeaderExpectations: true`)

**Interfaces:**
- Consumes: Task 1 functions; Task 2 tables, `notifyAlert`, `AlertType`
- Produces:
  - `runSecurityHeaderCheck(site: Site): Promise<SecurityHeaderCheckRun | null>`: `null` when the fetch fails or `!isEvaluableStatus(status)`
  - `reconcileSecurityHeaders(site: Site, run: { id: string; protections: ProtectionKey[] }): Promise<void>`: shared with the Task 4 actions

- [ ] **Step 1: Implement `runSecurityHeaderCheck`**

It calls `fetchHtml(site.primaryUrl)`, applies the status guard, inserts the run with `pickSecurityHeaders(result.headers)` and `evaluateProtections(..., result.finalUrl)`, then calls `reconcileSecurityHeaders`.

- [ ] **Step 2: Implement `reconcileSecurityHeaders`**

Order:
1. Load the site's expectations.
2. Run `compareWithExpectations`. Insert `newlyExpected` rows with `onConflictDoNothing()`, which handles a cron run and a page-view run racing.
3. Find the existing alert: `type = "security_header_regression"` and `status IN ('open', 'acknowledged')`. Do not use the shared `openAlert`/`resolveAlert`, which only match `open`.
4. Decide by state:

| Regressions? | Existing alert? | Action |
|---|---|---|
| yes | no | Insert the alert with `describeRegressions`, `regressionSeverity`, `relatedRunType: "security_header_check_run"`, `relatedRunId`. Then call `notifyAlert`. |
| yes | yes | Update `message`, `severity`, `relatedRunId` in place and keep `status`. Call `notifyAlert` only when the old severity was warning and the new one is critical. |
| no | yes | Set `status: "resolved"`, `resolvedAt`, `resolutionNote: "Security headers restored or disabled."`. |
| no | no | Nothing. |

- [ ] **Step 3: Wire the route, `crons.json` and `runAll.ts`**

The route is identical to the compliance route apart from the check it calls. `runAll.ts` gets `securityHeaderCheckRuns: { checkedAt: Date }[]` on its `Site` type, a `skipSecurityHeaders = isRecent(...)` throttle, and joins `ranAnyCheck`.

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: clean.

- [ ] **Step 5: Verify against the local DB**

Start the dev server on `$PORT` (per `verify-with-dev-server`). Insert a client and a site with `primary_url = 'https://snb-law.de'` via `envrun` + `psql`.

1. Run `curl -s localhost:$PORT/api/cron/security-headers`. Expected: one run row and 16 `expected` rows; no alert.
2. Insert an `expected` row `csp:prefetch-src` (a directive SNB does not send) and run the route again. Expected: one `security_header_regression` alert, `warning`, message `SNB Law Website: lost CSP prefetch-src`.
3. Set the alert's status to `acknowledged`, then set the site's `primary_url` to `https://kommunikationshafen.de` and run again. That site has no HSTS, CSP or Permissions-Policy, which simulates the snb-law relaunch. Expected: still one alert row, still `acknowledged`, now `critical`, and the message lists `HSTS` among the losses.
4. Set the site to an unreachable URL (`https://does-not-exist.invalid`) and run again. Expected: no new run row; the alert is unchanged.
5. Restore `https://snb-law.de`, delete the `csp:prefetch-src` row and run again. Expected: the alert is `resolved`.

Kill the dev server by PID and confirm with `ps -p <PID>`. Delete the test client (cascades).

- [ ] **Step 6: Commit (after user approval)**

`feat(security-headers): run daily header check and reconcile alerts`

---

### Task 4: Disable and re-monitor actions

**Files:**
- Modify: `src/lib/actions.ts`

**Interfaces:**
- Consumes: `reconcileSecurityHeaders` (Task 3), `siteSecurityHeaderExpectations`, `securityHeaderCheckRuns` (Task 2), `auth` from `@/auth`
- Produces:
  - `disableSecurityProtection(siteId: string, protectionKey: string, formData: FormData): Promise<void>`: reads optional `note`. It upserts the row to `status: "disabled"`, `disabledAt: now`, `disabledBy: session?.user?.email ?? null`, `disabledNote`, `updatedAt`.
  - `monitorSecurityProtection(siteId: string, protectionKey: string): Promise<void>`: sets `status: "expected"`, clears the `disabled*` columns, sets `updatedAt`.
  - Both then load the site and its latest `securityHeaderCheckRuns` row and call `reconcileSecurityHeaders` if a run exists. Then they `revalidatePath(\`/sites/${siteId}\`)`, `"/alerts"` and `"/"`.

- [ ] **Step 1: Implement both actions**

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean. Behaviour is verified through the UI in Task 5.

- [ ] **Step 3: Commit (after user approval)**

`feat(security-headers): let users disable and re-monitor protections per site`

---

### Task 5: Site page panel and alerts page link

**Files:**
- Create: `src/app/sites/[id]/SecurityHeadersPanel.tsx` (server component)
- Modify: `src/app/sites/[id]/page.tsx` (render the panel after the Compliance panel)
- Modify: `src/app/alerts/page.tsx` (lines 74-79)

**Interfaces:**
- Consumes: `summarizeProtections`, `describeProtection`, `SECURITY_HEADER_NAMES`, `BASE_PROTECTIONS` (Task 1); the two actions (Task 4); `Badge`, `Panel`, `TextInput`, `SubmitButton`
- Produces: `SecurityHeadersPanel({ siteId, run, expectations })`, where `run` is the latest `securityHeaderCheckRuns` row or `undefined`, and `expectations` are all expectation rows

- [ ] **Step 1: Build the panel**

Heading "Security headers". Without a run: "No checks yet."

Contents, top to bottom:
1. **"Disabled for this site"**: shown only when disabled rows exist. One line per row with `describeProtection(key)`, `disabledAt` date, `disabledBy`, `disabledNote`, and a "Monitor again" form button.
2. **Protection states** as badges, using `summarizeProtections`:

   | State | Badge tone | Extra |
   |---|---|---|
   | `present` | aurora | |
   | `lost` | crimson | form with optional `note` input and "Disable for this site" |
   | `missing` | gold for base keys, neutral otherwise | |
   | `disabled` | neutral, labelled "disabled" | |
   | `disabled_present` | neutral, labelled "disabled, present again" | "Monitor again" |

3. **Raw headers**: one row per `SECURITY_HEADER_NAMES` entry, value or "not set". The CSP value sits in a `<details>` element.
4. A footer line `checked <run.checkedAt.toLocaleString()> · <finalUrl>`.

- [ ] **Step 2: Alerts page**

For `alert.type === "security_header_regression"`, replace the Resolve form with `<Link href={\`/sites/${alert.siteId}\`}>Manage on site page</Link>`, styled like the ghost button. Acknowledge stays.

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: clean.

- [ ] **Step 4: Verify in the browser**

Repeat the Task 3 setup: the SNB test site plus an `expected` `csp:prefetch-src` row, then run the cron route. Open `/sites/<id>` on `$PORT`.

Expected:
- 16 present badges and one lost `CSP prefetch-src`.
- "Disable for this site" with the note "test" resolves the alert, and the disabled list shows the row with your email and the note.
- On `/alerts`, before disabling, the alert shows "Manage on site page" instead of Resolve.

Clean up the test data, kill the dev server by PID.

- [ ] **Step 5: Commit (after user approval)**

`feat(security-headers): show header status and disabled protections on site page`

---

### Task 6: Production rollout

- [ ] **Step 1:** Add the new check to the README section listing checks and crons, if one exists (`grep -n compliance README.md`).
- [ ] **Step 2:** Ask the user before pushing. Prod migrations run automatically on deploy (`scripts/migrate-prod.ts`). After the deploy, confirm the cron container picked up the new schedule and the first 04:00 run produced runs for all five sites with no alerts.
