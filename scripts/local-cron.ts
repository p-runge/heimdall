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

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const CRON_SECRET = process.env.CRON_SECRET;
const runNow = process.argv.includes("--now");

const vercelConfigPath = join(process.cwd(), "vercel.json");
const config = JSON.parse(readFileSync(vercelConfigPath, "utf-8")) as VercelConfig;
const crons = config.crons ?? [];

if (crons.length === 0) {
  console.log("no cron entries found in vercel.json");
  process.exit(0);
}

console.log(`Heimdall local cron runner — targeting ${APP_URL}`);

async function trigger(entry: VercelCronEntry) {
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
