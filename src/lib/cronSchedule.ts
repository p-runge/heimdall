import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Cron } from "croner";

interface VercelCronEntry {
  path: string;
  schedule: string;
}

interface VercelConfig {
  crons?: VercelCronEntry[];
}

let cachedEntries: VercelCronEntry[] | null = null;

function loadCronEntries(): VercelCronEntry[] {
  if (cachedEntries) return cachedEntries;
  const configPath = join(process.cwd(), "vercel.json");
  const config = JSON.parse(readFileSync(configPath, "utf-8")) as VercelConfig;
  cachedEntries = config.crons ?? [];
  return cachedEntries;
}

export function getCronScheduleExpression(routePath: string): string | undefined {
  return loadCronEntries().find((entry) => entry.path === routePath)?.schedule;
}

export function getNextRun(routePath: string): Date | null {
  const schedule = getCronScheduleExpression(routePath);
  if (!schedule) return null;
  return new Cron(schedule).nextRun();
}

const INTERVAL_UNITS: { label: (n: number) => string; ms: number }[] = [
  { label: (n) => `${n} day${n === 1 ? "" : "s"}`, ms: 24 * 60 * 60 * 1000 },
  { label: (n) => `${n} hour${n === 1 ? "" : "s"}`, ms: 60 * 60 * 1000 },
  { label: (n) => `${n} minute${n === 1 ? "" : "s"}`, ms: 60 * 1000 },
];

/** Derives a human-readable cadence (e.g. "every 10 minutes") from a cron schedule. */
export function describeCronInterval(routePath: string): string | null {
  const schedule = getCronScheduleExpression(routePath);
  if (!schedule) return null;

  const [first, second] = new Cron(schedule).nextRuns(2);
  if (!first || !second) return null;

  const diffMs = second.getTime() - first.getTime();
  for (const unit of INTERVAL_UNITS) {
    if (diffMs % unit.ms === 0) {
      return `every ${unit.label(diffMs / unit.ms)}`;
    }
  }
  return `every ${Math.round(diffMs / 60000)} minutes`;
}
