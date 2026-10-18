import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type FetchErrorCategory = "dns" | "connect" | "tls" | "timeout" | "unknown";

export type FetchError = {
  category: FetchErrorCategory;
  /** Raw error code from Node/undici (e.g. "EAI_AGAIN"), if one was present. */
  code?: string;
  /** Short, human-readable summary, stored as the run's error message. */
  message: string;
};

export type DnsProbeResult = { status: "ok" } | { status: "failed"; code?: string } | { status: "hung" };

const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "EAI_NONAME", "EAI_NODATA"]);
const CONNECT_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
]);
const TLS_CODES = new Set([
  "EPROTO",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
]);
const TLS_CODE_PREFIXES = ["CERT_", "ERR_TLS_", "ERR_SSL_"];
// undici's own (much longer) timeouts, distinct from the abort we schedule ourselves.
const TIMEOUT_CODES = new Set(["UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);

export function categorizeErrorCode(code: string | undefined): FetchErrorCategory {
  if (!code) return "unknown";
  if (DNS_CODES.has(code)) return "dns";
  if (CONNECT_CODES.has(code)) return "connect";
  if (TLS_CODES.has(code) || TLS_CODE_PREFIXES.some((prefix) => code.startsWith(prefix))) return "tls";
  if (TIMEOUT_CODES.has(code)) return "timeout";
  return "unknown";
}

/** Walks the `cause` chain (fetch wraps the real error as `TypeError("fetch failed")`)
 *  and returns the first error code plus the innermost message. Happy-eyeballs
 *  connects surface as an AggregateError, whose members carry the code. */
function extractCause(err: unknown): { code?: string; message?: string } {
  let code: string | undefined;
  let message: string | undefined;
  let current: unknown = err;

  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const candidate = (current as { code?: unknown }).code;
    if (!code && typeof candidate === "string") code = candidate;
    if (!code && current instanceof AggregateError) {
      const memberCode = (current.errors[0] as { code?: unknown } | undefined)?.code;
      if (typeof memberCode === "string") code = memberCode;
    }
    if (current.message) message = current.message;
    current = current.cause;
  }

  return { code, message };
}

function formatSeconds(ms: number) {
  return `${Number((ms / 1000).toFixed(1))} s`;
}

/** Translates a thrown fetch error into a fixed category with a readable message.
 *  Not for our own abort: an aborted request surfaces a generic AbortError, so
 *  that case goes through `describeTimeout` instead. */
export function classifyFetchError(err: unknown): FetchError {
  const { code, message } = extractCause(err);
  const category = categorizeErrorCode(code);

  switch (category) {
    case "dns":
      return { category, code, message: `DNS lookup failed (${code})` };
    case "connect":
      return { category, code, message: `Connection failed (${code})` };
    case "tls":
      return { category, code, message: `TLS error (${code})` };
    case "timeout":
      return { category, code, message: `Timed out waiting for the server (${code})` };
    default:
      return {
        category,
        code,
        message: `Request failed: ${message ?? String(err)}${code ? ` (${code})` : ""}`,
      };
  }
}

/** Refines a timeout message with the result of a follow-up DNS lookup, which
 *  tells a hanging resolver apart from a server that resolved but never answered. */
export function describeTimeout(timeoutMs: number, probe: DnsProbeResult): FetchError {
  const base = `Timed out after ${formatSeconds(timeoutMs)}`;
  switch (probe.status) {
    case "ok":
      return { category: "timeout", message: `${base} waiting for the server` };
    case "hung":
      return { category: "timeout", message: `${base} during DNS lookup` };
    case "failed":
      return {
        category: "timeout",
        code: probe.code,
        message: `${base}; DNS lookup failing${probe.code ? ` (${probe.code})` : ""}`,
      };
  }
}

/** Resolves `hostname` once more after a timeout, capped at `capMs`. Only meant
 *  for the failure path: a successful check never pays for this extra lookup. */
export async function probeDns(
  hostname: string,
  capMs = 3_000,
  resolve: (hostname: string) => Promise<unknown> = lookup,
): Promise<DnsProbeResult> {
  if (isIP(hostname.replace(/^\[|\]$/g, ""))) return { status: "ok" };

  let timer: NodeJS.Timeout | undefined;
  const hung = new Promise<DnsProbeResult>((done) => {
    timer = setTimeout(() => done({ status: "hung" }), capMs);
  });
  const attempt = resolve(hostname).then(
    (): DnsProbeResult => ({ status: "ok" }),
    (err): DnsProbeResult => ({ status: "failed", code: extractCause(err).code }),
  );

  try {
    return await Promise.race([attempt, hung]);
  } finally {
    clearTimeout(timer);
  }
}
