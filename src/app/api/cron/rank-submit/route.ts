import { NextResponse } from "next/server";
import pLimit from "p-limit";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sites } from "@/db/schema";
import { submitRankChecksForSite } from "@/checks/rank";

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
  const limit = pLimit(3);

  const results = await Promise.allSettled(
    activeSites.map((site) => limit(() => submitRankChecksForSite(site))),
  );

  const submitted = results
    .filter((r): r is PromiseFulfilledResult<number> => r.status === "fulfilled")
    .reduce((sum, r) => sum + r.value, 0);
  const failed = results.filter((r) => r.status === "rejected");

  return NextResponse.json({
    sites: activeSites.length,
    submitted,
    failed: failed.length,
    errors: failed.map((f) => (f as PromiseRejectedResult).reason?.message ?? "unknown error"),
  });
}
