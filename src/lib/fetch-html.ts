import { classifyFetchError, describeTimeout, probeDns, type FetchError } from "@/lib/fetch-error";

export const HEIMDALL_USER_AGENT = "HeimdallBot/1.0 (+https://heimdall.local)";

type FetchHtmlResult =
  | { ok: true; status: number; responseTimeMs: number; html: string; headers: Headers; finalUrl: string }
  | { ok: false; responseTimeMs: number; errorMessage: string; error: FetchError; status?: number };

async function toFailure(err: unknown, url: string, timedOut: boolean, timeoutMs: number, startedAt: number) {
  const responseTimeMs = Date.now() - startedAt;
  const error = timedOut
    ? describeTimeout(timeoutMs, await probeDns(new URL(url).hostname))
    : classifyFetchError(err);
  return { ok: false as const, responseTimeMs, errorMessage: error.message, error };
}

export async function fetchHtml(url: string, timeoutMs = 10_000): Promise<FetchHtmlResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const startedAt = Date.now();

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": HEIMDALL_USER_AGENT },
    });
    const html = await res.text();
    return {
      ok: true,
      status: res.status,
      responseTimeMs: Date.now() - startedAt,
      html,
      headers: res.headers,
      finalUrl: res.url,
    };
  } catch (err) {
    return await toFailure(err, url, timedOut, timeoutMs, startedAt);
  } finally {
    clearTimeout(timeout);
  }
}

/** Same as fetchHtml but does not follow redirects and never throws on non-2xx —
 * used where the status code itself is the signal (e.g. preview-environment auth walls). */
export async function fetchHtmlNoRedirect(url: string, timeoutMs = 10_000): Promise<FetchHtmlResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const startedAt = Date.now();

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "manual",
      headers: { "User-Agent": HEIMDALL_USER_AGENT },
    });
    const html = res.status >= 200 && res.status < 300 ? await res.text() : "";
    return {
      ok: true,
      status: res.status,
      responseTimeMs: Date.now() - startedAt,
      html,
      headers: res.headers,
      finalUrl: res.url,
    };
  } catch (err) {
    return await toFailure(err, url, timedOut, timeoutMs, startedAt);
  } finally {
    clearTimeout(timeout);
  }
}
