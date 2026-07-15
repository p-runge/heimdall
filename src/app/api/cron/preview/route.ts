import { NextResponse } from "next/server";
import pLimit from "p-limit";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { sites } from "@/db/schema";
import { runPreviewCheck } from "@/checks/preview";

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

  const previewSites = await db.query.sites.findMany({
    where: and(eq(sites.isActive, true), isNotNull(sites.previewUrl)),
  });
  const limit = pLimit(5);

  const results = await Promise.allSettled(
    previewSites.map((site) => limit(() => runPreviewCheck(site))),
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected");

  return NextResponse.json({
    checked: previewSites.length,
    succeeded,
    failed: failed.length,
    errors: failed.map((f) => (f as PromiseRejectedResult).reason?.message ?? "unknown error"),
  });
}
