import { NextResponse } from "next/server";
import { pollPendingRankChecks } from "@/checks/rank";

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

  const resolved = await pollPendingRankChecks();
  return NextResponse.json({ resolved });
}
