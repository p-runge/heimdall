export interface RankCheckParams {
  keyword: string;
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
  /** Polls a submitted task, matching results against targetDomain. Returns null while still processing. */
  poll(taskId: string, targetDomain: string): Promise<RankCheckResult | null>;
}
