import * as cheerio from "cheerio";
import { fetchHtml } from "@/lib/fetch-html";

// This is a safety ceiling, not a meaningful traffic control — grouping
// collapses large sections down to a handful of patterns regardless of how
// many raw URLs went in, and MAX_PATTERNS_PER_SITE is what actually bounds
// health-check volume. Keep this high enough that one large section (e.g.
// thousands of product pages in one locale) can never crowd out an entirely
// unrelated section (e.g. a second locale) before discovery even reaches it.
// Discovery runs once daily, off the every-minute hot path, so the extra
// parsing work here is cheap.
export const MAX_SITEMAP_URLS = 50_000;
export const MAX_CHILD_SITEMAPS = 20;

const SIBLING_COLLAPSE_THRESHOLD = 10;
const NUMERIC_SEGMENT = /^\d+$/;
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NON_PAGE_EXTENSION = /\.(pdf|jpe?g|png|gif|svg|webp|zip|xml|json|css|js|ico|mp4|mp3)$/i;

function isIdLikeSegment(segment: string) {
  return NUMERIC_SEGMENT.test(segment) || UUID_SEGMENT.test(segment);
}

/** One piece of content and every locale it's declared available in — the
 *  canonical <loc> plus its hreflang alternates (excluding "x-default", a
 *  locale-less redirect entry point, not a distinct page). */
function collectUrlGroups($: cheerio.CheerioAPI): string[][] {
  const groups: string[][] = [];
  $("url").each((_, urlEl) => {
    const loc = $(urlEl).find("> loc").first().text().trim();
    if (!loc) return;
    const members = new Set([loc]);
    $(urlEl)
      .find("> xhtml\\:link[rel=alternate]:not([hreflang=x-default])")
      .each((_, linkEl) => {
        const href = $(linkEl).attr("href");
        if (href) members.add(href.trim());
      });
    groups.push([...members]);
  });
  return groups;
}

/** Picks which URL(s) from a translation group to feed into pattern
 *  grouping. A group where every member is a bare locale segment (e.g. "/de"
 *  and "/en") is a set of genuinely distinct locale entry points — keep all
 *  of them, since each is worth monitoring on its own. Anything deeper (e.g.
 *  "/de/cards/2011bw-1" and its "/en/..." translation) is the same page
 *  template rendered in different languages — a broken template shows up
 *  regardless of locale, so keep just one representative (picked
 *  deterministically so re-discovery doesn't churn the sampled URL). */
function representativeUrls(group: string[], origin: string): string[] {
  const valid = group.filter((url) => {
    try {
      return new URL(url).origin === origin && !NON_PAGE_EXTENSION.test(url);
    } catch {
      return false;
    }
  });
  if (valid.length === 0) return [];

  const isLocaleRootGroup = valid.every(
    (url) => new URL(url).pathname.split("/").filter(Boolean).length <= 1,
  );
  return isLocaleRootGroup ? valid : [[...valid].sort()[0]];
}

async function findSitemapUrls(primaryUrl: string): Promise<string[]> {
  const origin = new URL(primaryUrl).origin;

  const robots = await fetchHtml(`${origin}/robots.txt`);
  if (robots.ok) {
    const matches = [...robots.html.matchAll(/^Sitemap:\s*(\S+)/gim)].map((m) => m[1]);
    if (matches.length > 0) return matches;
  }

  return [`${origin}/sitemap.xml`];
}

/** robots.txt "Sitemap:" line(s), else {origin}/sitemap.xml, recursing one level
 *  into sitemap indexes. Returns null if no sitemap exists at all (caller falls
 *  back to root-only). Throws on transient fetch/network errors so callers can
 *  tell "no sitemap" apart from "couldn't check right now". */
export async function discoverSitemapUrls(primaryUrl: string): Promise<string[] | null> {
  const origin = new URL(primaryUrl).origin;
  const candidates = await findSitemapUrls(primaryUrl);

  // Locale duplicates are resolved down to one representative as each group
  // is parsed (see representativeUrls), so this cap bounds the actually
  // useful working set, not raw pre-collapse sitemap volume.
  const urls = new Set<string>();
  let foundAnySitemap = false;

  const ingest = ($page: cheerio.CheerioAPI) => {
    for (const group of collectUrlGroups($page)) {
      for (const url of representativeUrls(group, origin)) urls.add(url);
    }
  };

  for (const sitemapUrl of candidates) {
    const result = await fetchHtml(sitemapUrl);
    if (!result.ok) continue;
    foundAnySitemap = true;

    const $ = cheerio.load(result.html, { xmlMode: true });
    const isIndex = $("sitemapindex").length > 0;

    if (isIndex) {
      const childSitemaps = $("sitemap > loc")
        .map((_, el) => $(el).text().trim())
        .get()
        .slice(0, MAX_CHILD_SITEMAPS);

      for (const childUrl of childSitemaps) {
        const child = await fetchHtml(childUrl);
        if (!child.ok) continue;
        ingest(cheerio.load(child.html, { xmlMode: true }));
        if (urls.size >= MAX_SITEMAP_URLS) break;
      }
    } else {
      ingest($);
    }

    if (urls.size >= MAX_SITEMAP_URLS) break;
  }

  if (!foundAnySitemap) return null;

  return [...urls].slice(0, MAX_SITEMAP_URLS);
}

/** Groups a flat URL list into representative page-type patterns: siblings
 *  sharing a parent path collapse into one pattern (with a representative
 *  sample URL) when the varying segment looks like an ID/UUID, or when there
 *  are more than a handful of siblings. Root ("/") is always force-included
 *  so the baseline check never regresses even if the sitemap is empty/missing. */
export function groupIntoPatterns(
  urls: string[],
  primaryUrl: string,
): { patternKey: string; sampleUrl: string; urlCount: number }[] {
  const parsedUrls: { pathname: string; segments: string[]; url: string }[] = [];
  for (const url of urls) {
    let pathname: string;
    try {
      pathname = new URL(url).pathname;
    } catch {
      continue;
    }
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length === 0) continue; // root, handled separately below
    parsedUrls.push({ pathname, segments, url });
  }

  // A path that is itself an ancestor of other sitemap URLs (e.g. /de/cards,
  // which has /de/cards/2011bw-1 etc. beneath it) is a section root, not an
  // interchangeable leaf instance — it must never be collapsed away by the
  // sibling-count heuristic below, no matter how many such sections exist.
  const hubPaths = new Set<string>();
  for (const { segments } of parsedUrls) {
    for (let depth = 1; depth < segments.length; depth++) {
      hubPaths.add("/" + segments.slice(0, depth).join("/"));
    }
  }

  const groups = new Map<string, { segment: string; url: string; pathname: string }[]>();
  for (const { pathname, segments, url } of parsedUrls) {
    const parentPath = "/" + segments.slice(0, -1).join("/");
    const lastSegment = segments[segments.length - 1];
    const key = `${segments.length}:${parentPath}`;
    const bucket = groups.get(key) ?? [];
    bucket.push({ segment: lastSegment, url, pathname });
    groups.set(key, bucket);
  }

  const patterns: { patternKey: string; sampleUrl: string; urlCount: number }[] = [
    { patternKey: "/", sampleUrl: primaryUrl, urlCount: 1 },
  ];

  for (const [key, entries] of groups) {
    const parentPath = key.slice(key.indexOf(":") + 1);
    const hubEntries = entries.filter((e) => hubPaths.has(e.pathname));
    const leafEntries = entries.filter((e) => !hubPaths.has(e.pathname));

    for (const entry of hubEntries) {
      patterns.push({ patternKey: entry.pathname, sampleUrl: entry.url, urlCount: 1 });
    }
    if (leafEntries.length === 0) continue;

    const idLike = leafEntries.every((e) => isIdLikeSegment(e.segment));
    const shouldCollapse = idLike || leafEntries.length > SIBLING_COLLAPSE_THRESHOLD;

    if (shouldCollapse) {
      const sample = [...leafEntries].sort((a, b) => a.url.localeCompare(b.url))[0];
      patterns.push({
        patternKey: parentPath === "/" ? "/*" : `${parentPath}/*`,
        sampleUrl: sample.url,
        urlCount: leafEntries.length,
      });
    } else {
      for (const entry of leafEntries) {
        patterns.push({ patternKey: entry.pathname, sampleUrl: entry.url, urlCount: 1 });
      }
    }
  }

  return patterns;
}
