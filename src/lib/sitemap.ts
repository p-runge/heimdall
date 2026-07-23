import * as cheerio from "cheerio";
import { fetchHtml } from "@/lib/fetch-html";

export const MAX_SITEMAP_URLS = 5000;
export const MAX_CHILD_SITEMAPS = 20;

const SIBLING_COLLAPSE_THRESHOLD = 4;
const NUMERIC_SEGMENT = /^\d+$/;
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NON_PAGE_EXTENSION = /\.(pdf|jpe?g|png|gif|svg|webp|zip|xml|json|css|js|ico|mp4|mp3)$/i;

function isIdLikeSegment(segment: string) {
  return NUMERIC_SEGMENT.test(segment) || UUID_SEGMENT.test(segment);
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

  const urls: string[] = [];
  let foundAnySitemap = false;

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
        const $child = cheerio.load(child.html, { xmlMode: true });
        $child("url > loc").each((_, el) => {
          urls.push($child(el).text().trim());
        });
        if (urls.length >= MAX_SITEMAP_URLS) break;
      }
    } else {
      $("url > loc").each((_, el) => {
        urls.push($(el).text().trim());
      });
    }

    if (urls.length >= MAX_SITEMAP_URLS) break;
  }

  if (!foundAnySitemap) return null;

  const sameOrigin = urls.filter((url) => {
    try {
      return new URL(url).origin === origin && !NON_PAGE_EXTENSION.test(url);
    } catch {
      return false;
    }
  });

  return [...new Set(sameOrigin)].slice(0, MAX_SITEMAP_URLS);
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
