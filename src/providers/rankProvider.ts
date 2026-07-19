export interface RankCheckParams {
  keyword: string;
  domain: string;
  country: string;
  device: "desktop" | "mobile";
}

export interface RankCheckResult {
  position: number | null;
  rankedUrl: string | null;
  serpFeatures?: Record<string, unknown>;
}

export interface RankProvider {
  name: "dataforseo" | "gsc";
  /** Submits a rank-check task; returns a provider-specific task id to poll later. */
  submit(params: RankCheckParams): Promise<{ taskId: string }>;
  /** Polls a submitted task. Returns null while the task is still processing. */
  poll(taskId: string): Promise<RankCheckResult | null>;
}
