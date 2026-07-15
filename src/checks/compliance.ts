import * as cheerio from "cheerio";
import { db } from "@/db";
import { complianceCheckRuns, type sites } from "@/db/schema";
import { fetchHtml } from "@/lib/fetch-html";
import { openAlert, resolveAlert } from "@/lib/alerts";

type Site = typeof sites.$inferSelect;
type CheerioAPI = ReturnType<typeof cheerio.load>;

const IMPRESSUM_PATTERN = /impressum|imprint|legal-notice/i;
const PRIVACY_PATTERN = /datenschutz|privacy-policy|privacy policy/i;

const CONSENT_TOOLS: { name: string; pattern: RegExp }[] = [
  { name: "Cookiebot", pattern: /cookiebot\.com/i },
  { name: "Usercentrics", pattern: /usercentrics\.(eu|com)/i },
  { name: "Borlabs Cookie", pattern: /borlabs-cookie/i },
  { name: "OneTrust", pattern: /onetrust\.com/i },
  { name: "CookieYes", pattern: /cookieyes\.com/i },
  { name: "Klaro", pattern: /klaro(\.js)?/i },
];

function findLink($: CheerioAPI, pattern: RegExp): string | undefined {
  let match: string | undefined;
  $("a[href]").each((_, el) => {
    if (match) return;
    const href = $(el).attr("href") ?? "";
    const text = $(el).text();
    if (pattern.test(href) || pattern.test(text)) match = href;
  });
  return match;
}

function resolveUrl(base: string, href: string) {
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

async function scanImpressumContent(url: string) {
  const result = await fetchHtml(url, 8_000);
  if (!result.ok) return { hasAddress: false, hasContact: false, hasRegisterNumber: false };

  const text = cheerio.load(result.html).text();
  return {
    hasAddress: /\b\d{4,5}\s+[A-ZÄÖÜ][a-zäöüß]+/.test(text), // German postcode + city pattern
    hasContact: /@[\w.-]+\.\w{2,}/.test(text) || /\+?\d[\d\s()/-]{7,}\d/.test(text),
    hasRegisterNumber: /(handelsregister|hrb|ust-?idnr|steuernummer)/i.test(text),
  };
}

export async function runComplianceCheck(site: Site) {
  const homepage = await fetchHtml(site.primaryUrl);
  if (!homepage.ok) return null;

  const $ = cheerio.load(homepage.html);

  const impressumHref = findLink($, IMPRESSUM_PATTERN);
  const privacyHref = findLink($, PRIVACY_PATTERN);

  const impressumUrl = impressumHref && resolveUrl(site.primaryUrl, impressumHref);
  const impressumHeuristics = impressumUrl
    ? await scanImpressumContent(impressumUrl)
    : { hasAddress: false, hasContact: false, hasRegisterNumber: false };

  const scripts = $("script[src]")
    .map((_, el) => $(el).attr("src") ?? "")
    .get()
    .join(" ");
  const detectedTool = CONSENT_TOOLS.find((tool) => tool.pattern.test(scripts));

  const unconsentedGoogleFonts =
    /fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(homepage.html) && !detectedTool;

  const [run] = await db
    .insert(complianceCheckRuns)
    .values({
      siteId: site.id,
      impressumFound: Boolean(impressumHref),
      impressumHeuristics,
      privacyPolicyFound: Boolean(privacyHref),
      cookieConsentToolDetected: Boolean(detectedTool),
      cookieConsentTool: detectedTool?.name,
      unconsentedGoogleFontsDetected: unconsentedGoogleFonts,
    })
    .returning();

  const issues: string[] = [];
  if (!impressumHref) issues.push("no Impressum page found");
  if (!privacyHref) issues.push("no privacy policy page found");
  if (unconsentedGoogleFonts) issues.push("Google Fonts loaded externally without a consent tool");

  if (issues.length > 0) {
    await openAlert({
      siteId: site.id,
      type: "compliance_issue",
      severity: "warning",
      message: `${site.name}: ${issues.join(", ")}`,
      relatedRunType: "compliance_check_run",
      relatedRunId: run.id,
    });
  } else {
    await resolveAlert(site.id, "compliance_issue", "Compliance heuristics look clean.");
  }

  return run;
}
