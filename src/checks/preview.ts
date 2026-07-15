import * as cheerio from "cheerio";
import { db } from "@/db";
import { previewCheckRuns, type sites } from "@/db/schema";
import { fetchHtmlNoRedirect } from "@/lib/fetch-html";
import { openAlert, resolveAlert } from "@/lib/alerts";

type Site = typeof sites.$inferSelect;

function hasNoIndexSignal(html: string, headers: Headers) {
  const robotsHeader = headers.get("x-robots-tag") ?? "";
  if (/noindex/i.test(robotsHeader)) return true;

  const content = cheerio.load(html)('meta[name="robots"]').attr("content") ?? "";
  return /noindex/i.test(content);
}

export async function runPreviewCheck(site: Site) {
  if (!site.previewUrl) return null;

  const result = await fetchHtmlNoRedirect(site.previewUrl);

  const httpStatus = result.ok ? result.status : undefined;
  const isPasswordProtected = httpStatus === 401 || httpStatus === 403;
  const hasNoIndexTag = result.ok && httpStatus === 200 ? hasNoIndexSignal(result.html, result.headers) : false;
  const isPubliclyExposed = httpStatus === 200 && !hasNoIndexTag;

  const [run] = await db
    .insert(previewCheckRuns)
    .values({
      siteId: site.id,
      httpStatus,
      isPasswordProtected,
      hasNoIndexTag,
      isPubliclyExposed,
    })
    .returning();

  if (isPubliclyExposed) {
    await openAlert({
      siteId: site.id,
      type: "preview_exposed",
      severity: "critical",
      message: `${site.name}'s preview environment is publicly reachable and indexable`,
      relatedRunType: "preview_check_run",
      relatedRunId: run.id,
    });
  } else {
    await resolveAlert(site.id, "preview_exposed", "Preview environment is protected or noindex.");
  }

  return run;
}
