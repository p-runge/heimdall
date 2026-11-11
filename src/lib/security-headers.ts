export const SECURITY_HEADER_NAMES = [
  "strict-transport-security",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "content-security-policy",
  "permissions-policy",
] as const;

export type SecurityHeaderName = (typeof SECURITY_HEADER_NAMES)[number];
export type RawSecurityHeaders = Partial<Record<SecurityHeaderName, string>>;

/**
 * A protection a response provides, derived from its headers. Comparisons
 * between runs use these keys rather than raw header strings, so a CSP that
 * gains a script host is not a change while one that drops a directive is.
 */
export type ProtectionKey =
  | "hsts"
  | "nosniff"
  | "framing"
  | "referrer_policy"
  | "permissions_policy"
  | `csp:${string}`;

/** Protections every site should have; shown as missing even if never seen. */
export const BASE_PROTECTIONS: ProtectionKey[] = ["hsts", "nosniff", "framing", "referrer_policy"];

/** Protections whose loss makes a regression critical. */
const CRITICAL_PROTECTIONS: ProtectionKey[] = ["hsts", "framing"];

export type ExpectationStatus = "expected" | "disabled";

export interface Expectation {
  protectionKey: string;
  status: ExpectationStatus;
}

export type ProtectionState = "present" | "missing" | "lost" | "disabled" | "disabled_present";

const PROTECTION_LABELS: Record<string, string> = {
  hsts: "HSTS",
  nosniff: "X-Content-Type-Options: nosniff",
  framing: "Framing protection",
  referrer_policy: "Referrer-Policy",
  permissions_policy: "Permissions-Policy",
};

/** Directive names per the CSP grammar: 1*( ALPHA / DIGIT / "-" ). */
export const CSP_DIRECTIVE_NAME = /^[a-z0-9-]+$/;

/** Content-Security-Policy-Report-Only is deliberately not read: it enforces nothing. */
export function pickSecurityHeaders(headers: Headers): RawSecurityHeaders {
  const picked: RawSecurityHeaders = {};
  for (const name of SECURITY_HEADER_NAMES) {
    const value = headers.get(name);
    if (value !== null) picked[name] = value;
  }
  return picked;
}

/**
 * Parses a CSP header into directive name → sources. `Headers.get()` joins
 * repeated headers with ", ", so several policies are split on commas and
 * merged; a directive counts as present if any policy has it. Within one
 * policy the first occurrence of a directive wins, as browsers do.
 */
export function parseCspDirectives(value: string | undefined): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  if (!value) return directives;

  for (const policy of value.split(",")) {
    const seenInPolicy = new Set<string>();
    for (const segment of policy.split(";")) {
      const [name, ...sources] = segment.trim().split(/\s+/);
      const directive = name?.toLowerCase();
      // A stray comma in a source list leaves fragments like a bare URL in
      // directive position; browsers ignore those, and so does this parser.
      if (!directive || !CSP_DIRECTIVE_NAME.test(directive)) continue;
      if (seenInPolicy.has(directive)) continue;
      seenInPolicy.add(directive);
      if (!directives.has(directive)) directives.set(directive, sources);
    }
  }
  return directives;
}

function headerValues(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

function hstsMaxAge(value: string): number {
  const match = /(?:^|;)\s*max-age\s*=\s*"?(\d+)"?/i.exec(value);
  return match ? Number(match[1]) : 0;
}

export function evaluateProtections(headers: RawSecurityHeaders, finalUrl: string): ProtectionKey[] {
  const protections = new Set<ProtectionKey>();

  const hsts = headers["strict-transport-security"];
  if (hsts && finalUrl.startsWith("https:") && hstsMaxAge(hsts) > 0) protections.add("hsts");

  // Repeated headers (proxy and app both setting one) arrive joined by ", ".
  // Browsers read nosniff from the first value and honour X-Frame-Options only
  // when every value is a valid one.
  if (headerValues(headers["x-content-type-options"])[0] === "nosniff") protections.add("nosniff");

  const xfo = headerValues(headers["x-frame-options"]);
  if (xfo.length > 0 && xfo.every((v) => v === "deny" || v === "sameorigin")) {
    protections.add("framing");
  }

  const csp = parseCspDirectives(headers["content-security-policy"]);
  for (const directive of csp.keys()) protections.add(`csp:${directive}`);
  const frameAncestors = csp.get("frame-ancestors");
  if (frameAncestors && !frameAncestors.includes("*")) protections.add("framing");

  const referrerPolicy = headers["referrer-policy"]?.trim().toLowerCase();
  if (referrerPolicy && referrerPolicy !== "unsafe-url") protections.add("referrer_policy");

  if (headers["permissions-policy"]?.trim()) protections.add("permissions_policy");

  return [...protections].sort();
}

/** Error pages and redirects carry other headers than the site; only 2xx is compared. */
export function isEvaluableStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

export function compareWithExpectations(
  present: ProtectionKey[],
  expectations: Expectation[],
): { newlyExpected: ProtectionKey[]; regressions: ProtectionKey[] } {
  const known = new Set(expectations.map((e) => e.protectionKey));
  const presentSet = new Set<string>(present);
  return {
    newlyExpected: present.filter((key) => !known.has(key)),
    regressions: expectations
      .filter((e) => e.status === "expected" && !presentSet.has(e.protectionKey))
      .map((e) => e.protectionKey as ProtectionKey),
  };
}

export function regressionSeverity(regressions: ProtectionKey[]): "warning" | "critical" {
  return regressions.some((key) => CRITICAL_PROTECTIONS.includes(key)) ? "critical" : "warning";
}

export function describeProtection(key: string): string {
  if (key.startsWith("csp:")) return `CSP ${key.slice("csp:".length)}`;
  return PROTECTION_LABELS[key] ?? key;
}

export function describeRegressions(siteName: string, regressions: ProtectionKey[]): string {
  return `${siteName}: lost ${regressions.map(describeProtection).join(", ")}`;
}

/** One entry per base protection and per protection seen or expected, base ones first. */
export function summarizeProtections(
  present: ProtectionKey[],
  expectations: Expectation[],
): { key: string; state: ProtectionState }[] {
  const presentSet = new Set<string>(present);
  const statusByKey = new Map(expectations.map((e) => [e.protectionKey, e.status]));
  const base: string[] = BASE_PROTECTIONS;
  const others = [...new Set([...present, ...statusByKey.keys()])]
    .filter((key) => !base.includes(key))
    .sort();

  return [...base, ...others].map((key) => {
    const status = statusByKey.get(key);
    const isPresent = presentSet.has(key);
    if (status === "disabled") return { key, state: isPresent ? "disabled_present" : "disabled" };
    if (isPresent) return { key, state: "present" };
    return { key, state: status === "expected" ? "lost" : "missing" };
  });
}
