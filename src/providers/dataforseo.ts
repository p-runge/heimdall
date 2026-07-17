import type { RankCheckParams, RankCheckResult, RankProvider } from "./rankProvider";

const DATAFORSEO_BASE = "https://api.dataforseo.com/v3";

// DataForSEO location_code per country — extend as more markets are tracked.
const COUNTRY_LOCATION_CODES: Record<string, number> = {
  de: 2276,
  us: 2840,
  at: 2040,
  ch: 2756,
  gb: 2826,
};

function getAuthHeader() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
}

function buildTaskPayload({ keyword, domain, country, device, language }: RankCheckParams) {
  return [
    {
      keyword,
      location_code: COUNTRY_LOCATION_CODES[country] ?? COUNTRY_LOCATION_CODES.de,
      language_code: language ?? "de",
      device,
      target: domain,
    },
  ];
}

// Strips a leading "www." and lowercases so "www.bulkratte.de" and "bulkratte.de"
// are treated as the same site regardless of which way primaryUrl is stored.
function normalizeDomain(host: string) {
  return host.toLowerCase().replace(/^www\./, "");
}

// True if `candidate` is the target domain itself or a subdomain of it. Using
// endsWith on the normalized suffix (rather than a plain substring check) also
// avoids false positives like "notbulkratte.de" matching target "bulkratte.de".
function isDomainMatch(target: string, candidate: string) {
  const t = normalizeDomain(target);
  const c = normalizeDomain(candidate);
  return c === t || c.endsWith(`.${t}`);
}

function extractRanking(
  targetDomain: string | undefined,
  items?: { type?: string; domain?: string; url?: string; rank_absolute?: number }[],
): { position: number | null; rankedUrl: string | null } {
  if (!targetDomain) return { position: null, rankedUrl: null };
  const match = items?.find(
    (item) => item.type === "organic" && item.domain && isDomainMatch(targetDomain, item.domain),
  );
  return { position: match?.rank_absolute ?? null, rankedUrl: match?.url ?? null };
}

interface DataForSeoTaskPostResponse {
  status_message?: string;
  tasks?: { id?: string; status_message?: string }[] | null;
}

interface DataForSeoTaskGetResponse {
  tasks?: {
    status_code?: number;
    status_message?: string;
    data?: { target?: string };
    result?: {
      se_results_count?: number;
      items?: { type?: string; domain?: string; url?: string; rank_absolute?: number }[];
    }[];
  }[];
}

export const dataForSeoProvider: RankProvider = {
  name: "dataforseo",

  async submit({ keyword, domain, country, device, language }: RankCheckParams) {
    const auth = getAuthHeader();
    if (!auth) throw new Error("DataForSEO credentials are not configured (DATAFORSEO_LOGIN/PASSWORD)");

    const res = await fetch(`${DATAFORSEO_BASE}/serp/google/organic/task_post`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify(buildTaskPayload({ keyword, domain, country, device, language })),
    });

    const data = (await res.json()) as DataForSeoTaskPostResponse;
    const taskId = data.tasks?.[0]?.id;
    if (!taskId) {
      // Account-level failures (e.g. unverified account, insufficient balance) put the
      // reason at the top-level status_message and leave tasks null; only per-task
      // failures nest it under tasks[0].
      throw new Error(
        `DataForSEO task submission failed: ${
          data.tasks?.[0]?.status_message ?? data.status_message ?? res.statusText
        }`,
      );
    }
    return { taskId };
  },

  async poll(taskId: string): Promise<RankCheckResult | null> {
    const auth = getAuthHeader();
    if (!auth) throw new Error("DataForSEO credentials are not configured (DATAFORSEO_LOGIN/PASSWORD)");

    const res = await fetch(`${DATAFORSEO_BASE}/serp/google/organic/task_get/advanced/${taskId}`, {
      headers: { Authorization: auth },
    });
    const data = (await res.json()) as DataForSeoTaskGetResponse;
    const task = data.tasks?.[0];

    // status_code 20000 = task complete; anything still queued/in-progress yields no result yet.
    if (!task || task.status_code !== 20000) return null;

    const result = task.result?.[0];
    if (!result) return { position: null, rankedUrl: null };

    const { position, rankedUrl } = extractRanking(task.data?.target, result.items);
    return { position, rankedUrl, serpFeatures: { seResultsCount: result.se_results_count } };
  },

  // Used for on-demand "run check now" checks: DataForSEO's live endpoint resolves
  // synchronously in the same request instead of requiring a task_post + poll round trip,
  // so a manual check never sits in "pending" waiting for the next cron tick.
  async checkNow({ keyword, domain, country, device, language }: RankCheckParams): Promise<RankCheckResult> {
    const auth = getAuthHeader();
    if (!auth) throw new Error("DataForSEO credentials are not configured (DATAFORSEO_LOGIN/PASSWORD)");

    const res = await fetch(`${DATAFORSEO_BASE}/serp/google/organic/live/advanced`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify(buildTaskPayload({ keyword, domain, country, device, language })),
    });

    if (!res.ok) {
      throw new Error(`DataForSEO live request failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as DataForSeoTaskGetResponse;
    const task = data.tasks?.[0];
    if (!task || task.status_code !== 20000) {
      throw new Error(`DataForSEO live check failed: ${task?.status_message ?? "unknown error"}`);
    }

    const result = task.result?.[0];
    if (!result) return { position: null, rankedUrl: null };

    const { position, rankedUrl } = extractRanking(domain, result.items);
    return { position, rankedUrl, serpFeatures: { seResultsCount: result.se_results_count } };
  },
};
