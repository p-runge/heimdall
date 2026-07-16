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

interface DataForSeoTaskPostResponse {
  status_message?: string;
  tasks?: { id?: string; status_message?: string }[] | null;
}

interface DataForSeoTaskGetResponse {
  tasks?: {
    status_code?: number;
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
      body: JSON.stringify([
        {
          keyword,
          location_code: COUNTRY_LOCATION_CODES[country] ?? COUNTRY_LOCATION_CODES.de,
          language_code: language ?? "de",
          device,
          target: domain,
        },
      ]),
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

    const targetDomain = task.data?.target;
    const match = result.items?.find(
      (item) => item.type === "organic" && item.domain && targetDomain && item.domain.includes(targetDomain),
    );

    return {
      position: match?.rank_absolute ?? null,
      rankedUrl: match?.url ?? null,
      serpFeatures: { seResultsCount: result.se_results_count },
    };
  },
};
