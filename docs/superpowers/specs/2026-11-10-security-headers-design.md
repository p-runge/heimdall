# Security header monitoring

Date: 2026-11-10
Status: design approved, not implemented

## Why

After the snb-law.de relaunch the site stopped sending the security headers the
old site had sent. Nobody noticed until a data protection officer pointed it out
after go-live. Heimdall should catch that kind of regression itself.

A survey of the five active sites on 2026-11-10 shows the spread this has to
handle:

| Site | HSTS | nosniff | Framing | Referrer-Policy | CSP | Permissions-Policy |
|---|---|---|---|---|---|---|
| SNB Law | yes | yes | XFO + frame-ancestors | yes | yes | yes |
| Hüttenzauber, Kommunikationshafen, Weihnachtsmarkt (nginx) | no | yes | XFO | yes | no | no |
| Bulkratte (Next.js) | yes | yes | XFO + frame-ancestors | yes | yes | yes |

All five redirect `http://` to `https://` with a 302; Bulkratte additionally
answers `/` with a 307 to `/de`.

## Goals

- Once a day, check the response headers of each active site's `primaryUrl`.
- Alert when a protection the site used to have is gone, and resolve the alert
  when it comes back.
- Show the current headers and their state on the site detail page, including
  headers that were never set.
- Let the user declare, per site, that a protection is deliberately disabled.
  That declaration is a property of the site, visible on the site page, not
  something inferred from alert history.

## Non-goals

- No alert for a protection that was never present, for any header. A new site
  shows its missing headers on its detail page, which is enough of a hint.
- No judgement of header quality beyond the protection rules below: a CSP that
  gains `'unsafe-inline'`, an HSTS `max-age` that drops from two years to one,
  or a lost `includeSubDomains`/`preload` is not a regression.
- No check of whether `http://` redirects to `https://`.
- Only `primaryUrl` is checked, not every discovered page pattern.
- No changes to the compliance check or the `compliance_issue` alert.

## Anti-goals

- Daily noise for sites that simply never had headers. That would train us to
  ignore the channel.
- An alert that silently disappears the next day because the broken state has
  become the new "last run". A regression stays open until the protection is
  back or the user disables it on purpose.

## Protections

The check evaluates headers into a set of named protections and compares
protections, never raw strings. Raw values are stored for display only.

| Protection key | Present when | Severity when lost |
|---|---|---|
| `hsts` | the final response URL is `https:` and `Strict-Transport-Security` has `max-age` > 0 | critical |
| `nosniff` | `X-Content-Type-Options` is `nosniff` (case-insensitive) | warning |
| `framing` | `X-Frame-Options` is `DENY` or `SAMEORIGIN`, **or** the CSP has a `frame-ancestors` directive whose sources do not include `*` | critical |
| `referrer_policy` | `Referrer-Policy` is set to any value other than `unsafe-url` | warning |
| `csp:<directive>` | one key per directive present in `Content-Security-Policy`, e.g. `csp:frame-ancestors`, `csp:script-src` | warning |
| `permissions_policy` | `Permissions-Policy` is set | warning |

Notes:

- `Content-Security-Policy-Report-Only` does not count.
- `Headers.get()` joins repeated headers with `, `. A response may carry several
  CSP policies; a directive counts as present if any policy contains it.
- Losing `frame-ancestors` while `X-Frame-Options` still protects the site is a
  `csp:frame-ancestors` regression (warning), not a `framing` regression. If
  both go, both keys are lost and the alert is critical.
- Base headers (HSTS, nosniff, framing, Referrer-Policy) and optional headers
  (CSP, Permissions-Policy) are treated the same way. The distinction only
  matters for display: a missing base header is shown more prominently.

## Per-site expectations

Each site has an expectation per protection key, stored in a new table, e.g.
`site_security_header_expectations` (`site_id`, `protection_key`, `status`,
timestamps, plus who disabled it and an optional note). `status` is one of:

- `expected`: the protection was seen at least once and must stay.
- `disabled`: the user declared the protection deliberately off for this site.

A key with no row has never been seen and is not monitored.

Rules applied on every successful run:

1. Every protection present now and without a row gets an `expected` row. This
   is how the baseline grows, including on the very first run.
2. A protection with an `expected` row that is absent now is a **regression**.
3. A `disabled` row is never a regression, whether the protection is present or
   not. If the protection is present again, the UI offers to monitor it again
   (sets the row back to `expected`). The row does not flip on its own: the
   user's decision stands until the user changes it.

This table is the single source of truth for "what is disabled on this site".
The alert history is never consulted to derive it.

Changing a site's `primaryUrl` leaves the expectations untouched. A relaunch,
whether on the same path, a new path or a new domain, is measured against what
the old site had, which is exactly the snb-law case. A site that really moved
and should send fewer headers gets those protections disabled once on its page.
Editing `primaryUrl` therefore needs no change to the site-update action.

## Runs

New table, e.g. `security_header_check_runs`: `site_id`, `checked_at`,
`final_url`, `http_status`, the raw values of the six headers (jsonb), and the
evaluated set of present protection keys (jsonb).

The check fetches `primaryUrl` with redirects followed (`fetchHtml` already
exposes `headers` and `finalUrl`) and evaluates the final response.

If the fetch fails or the final status is not 2xx, the check records nothing
and compares nothing. An outage or an error page must not look like "every
header vanished"; the health check already reports outages.

## Alerts

- New `alert_type` value `security_header_regression` (Drizzle enum migration),
  label "Security header regression", ntfy tags `["shield"]`, ntfy priority
  `default` for warning and `high` for critical.
- One open alert per site at most, listing every protection currently regressed.
  Severity is critical if `hsts` or `framing` is among them, otherwise warning.
- If an alert is already open and the set of regressions changes, update its
  message and severity in place. Push a new notification only when the severity
  rises from warning to critical.
- Resolve the alert as soon as a run finds no regressions, whether because the
  protections came back or the user disabled them.

"Open" here means not resolved: an `acknowledged` alert counts as the site's
existing alert. It is updated in place like an open one, keeps its status, and
is auto-resolved by the same rule. An escalation to critical pushes but does not
flip it back to `open`. The shared `openAlert`/`resolveAlert` only match
`status = 'open'`, so this lookup is specific to the security header check;
the shared helpers and every other alert type keep their behaviour. (Builder's
call.)

Manual resolve on `/alerts` is not a way to accept a regression: the next run
would simply open a new alert. For this alert type the alerts page replaces the
Resolve button with a link to the site page, where "Disable for this site" is
the way to accept the new state. (Builder's call.)

## Site detail page

A new "Security headers" panel, next to the existing Compliance panel:

- A row per header (HSTS, X-Content-Type-Options, X-Frame-Options,
  Referrer-Policy, Content-Security-Policy, Permissions-Policy) with its current
  raw value. The CSP value is long, so collapse or truncate it.
- State per protection: present, missing (never seen), **lost** (regression,
  highlighted), or disabled.
- A clearly visible list "Disabled for this site", with the protection, the date,
  who disabled it, and the note. This is the user's answer to "what is the new
  normal for this site?".
- Actions:
  - On a lost protection: "Disable for this site" (optional note). It sets the
    row to `disabled` and re-evaluates the latest run, which resolves the alert
    once nothing is regressed any more.
  - On a disabled protection: "Monitor again". It sets the row back to
    `expected`. If the protection is absent at that moment, the next run reports
    it as a regression; that is intended.

## Scheduling

- A separate check, `src/checks/security-headers.ts`, not folded into
  `compliance.ts`. That keeps failures, throttling and alerts independent.
- A new route `/api/cron/security-headers` modelled on
  `/api/cron/compliance`, scheduled `0 4 * * *` in `crons.json`. The prod cron
  container and the UI's schedule display both read `crons.json`, so no other
  wiring is needed.
- Added to `runSiteChecks` in `src/checks/runAll.ts` with the same one-minute
  throttle, so opening a site page (including right after creating it) shows a
  fresh result.

## Tests

Unit tests with the existing `node:test` setup (`pnpm test`), on pure functions
with no database:

- Header evaluation into protection keys, including every row of the table
  above, `http:` final URLs for HSTS, `max-age=0`, `ALLOW-FROM`, and
  case-insensitivity.
- CSP parsing: directive extraction, `frame-ancestors` with `'none'`, `'self'`,
  hosts and `*`, multiple policies joined by `, `, empty and malformed values.
- Comparison of expectations with a run: new keys become expected, lost
  expected keys are regressions, disabled keys are never regressions, the
  severity rule, and "nothing regressed" for a site that never had headers.

## Left to the builder

- Exact table and column names, and whether raw headers and protection keys
  share one jsonb column.
- How to record who disabled a protection (user id or email from the session).
- Layout and wording of the panel, within the existing `src/components/ui.tsx`
  components.
- Where the comparison logic lives, as long as it is a pure function the tests
  can call.
