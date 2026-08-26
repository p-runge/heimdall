import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Cron } from "croner";

interface CronEntry {
  path: string;
  schedule: string;
}

interface CronConfig {
  crons?: CronEntry[];
}

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const CRON_SECRET = process.env.CRON_SECRET;
const runNow = process.argv.includes("--now");

const cronConfigPath = join(process.cwd(), "crons.json");
const config = JSON.parse(readFileSync(cronConfigPath, "utf-8")) as CronConfig;
const crons = config.crons ?? [];

if (crons.length === 0) {
  console.log("no cron entries found in crons.json");
  process.exit(0);
}

console.log(`Heimdall local cron runner — targeting ${APP_URL}`);

async function trigger(entry: CronEntry) {
  const startedAt = Date.now();
  try {
    const res = await fetch(`${APP_URL}${entry.path}`, {
      headers: CRON_SECRET ? { authorization: `Bearer ${CRON_SECRET}` } : undefined,
    });
    const body = await res.text();
    console.log(`${entry.path} -> ${res.status} (${Date.now() - startedAt}ms) ${body}`);
  } catch (err) {
    console.error(`${entry.path} failed:`, err instanceof Error ? err.message : err);
  }
}

for (const entry of crons) {
  console.log(`scheduled ${entry.path} @ "${entry.schedule}"`);
  new Cron(entry.schedule, () => trigger(entry));
  if (runNow) trigger(entry);
}
