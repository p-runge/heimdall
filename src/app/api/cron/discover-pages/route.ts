import { NextResponse } from "next/server";
import pLimit from "p-limit";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sites } from "@/db/schema";
import { runPageDiscovery } from "@/checks/discovery";

export const runtime = "nodejs";
export const maxDuration = 60;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const activeSites = await db.query.sites.findMany({ where: eq(sites.isActive, true) });
  const limit = pLimit(5);

  const results = await Promise.allSettled(
    activeSites.map((site) => limit(() => runPageDiscovery(site))),
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected");

  return NextResponse.json({
    checked: activeSites.length,
    succeeded,
    failed: failed.length,
    errors: failed.map((f) => (f as PromiseRejectedResult).reason?.message ?? "unknown error"),
  });
}
