"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  alerts,
  clients,
  keywords,
  securityHeaderCheckRuns,
  sites,
  siteSecurityHeaderExpectations,
} from "@/db/schema";
import { runHealthCheck } from "@/checks/health";
import { submitRankChecksForSite } from "@/checks/rank";
import { reconcileSecurityHeaders } from "@/checks/security-headers";
import { isSignedIn } from "@/lib/session";

// Server actions are reachable by a plain POST, so each one checks the session
// itself instead of relying on the proxy alone.
async function requireUser(): Promise<string> {
  const session = await auth();
  if (!isSignedIn(session)) throw new Error("not signed in");
  return session.user.email;
}

function requireString(formData: FormData, key: string) {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function optionalString(formData: FormData, key: string) {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return value.trim();
}

function normalizeUrl<T extends string | undefined>(value: T): T {
  if (value === undefined) return value;
  const lowercased = value.toLowerCase();
  const normalized = /^[a-z][a-z0-9+.-]*:\/\//i.test(lowercased)
    ? lowercased
    : `https://${lowercased}`;
  return normalized as T;
}

export async function createClient(formData: FormData) {
  await requireUser();
  const name = requireString(formData, "name");
  const contactEmail = optionalString(formData, "contactEmail");
  const notes = optionalString(formData, "notes");

  await db.insert(clients).values({ name, contactEmail, notes });
  revalidatePath("/clients");
}

export async function deleteClient(clientId: string) {
  await requireUser();
  await db.delete(clients).where(eq(clients.id, clientId));
  revalidatePath("/clients");
  redirect("/clients");
}

export async function updateClient(clientId: string, formData: FormData) {
  await requireUser();
  const name = requireString(formData, "name");
  const contactEmail = optionalString(formData, "contactEmail");
  const notes = optionalString(formData, "notes");

  await db
    .update(clients)
    .set({ name, contactEmail: contactEmail ?? null, notes: notes ?? null })
    .where(eq(clients.id, clientId));
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/clients");
}

export async function createSite(formData: FormData) {
  await requireUser();
  const clientId = requireString(formData, "clientId");
  const name = requireString(formData, "name");
  const primaryUrl = normalizeUrl(requireString(formData, "primaryUrl"));
  const previewUrl = normalizeUrl(optionalString(formData, "previewUrl"));
  const githubOwner = optionalString(formData, "githubOwner");
  const githubRepo = optionalString(formData, "githubRepo");
  const prodBranch = optionalString(formData, "prodBranch") ?? "main";

  const [site] = await db
    .insert(sites)
    .values({ clientId, name, primaryUrl, previewUrl, githubOwner, githubRepo, prodBranch })
    .returning();

  // Run the first health check right away rather than waiting for the next
  // scheduled tick. runHealthCheck never throws on network failure (a down
  // site just yields an isUp:false row); only a genuine bug would land here.
  try {
    await runHealthCheck(site);
  } catch (err) {
    console.error(`initial health check failed for site ${site.id}:`, err);
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/");
}

export async function deleteSite(siteId: string, clientId: string) {
  await requireUser();
  await db.delete(sites).where(eq(sites.id, siteId));
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/");
  redirect(`/clients/${clientId}`);
}

export async function updateSite(siteId: string, formData: FormData) {
  await requireUser();
  const name = requireString(formData, "name");
  const primaryUrl = normalizeUrl(requireString(formData, "primaryUrl"));
  const previewUrl = normalizeUrl(optionalString(formData, "previewUrl"));
  const githubOwner = optionalString(formData, "githubOwner");
  const githubRepo = optionalString(formData, "githubRepo");
  const prodBranch = optionalString(formData, "prodBranch") ?? "main";

  await db
    .update(sites)
    .set({
      name,
      primaryUrl,
      previewUrl: previewUrl ?? null,
      githubOwner: githubOwner ?? null,
      githubRepo: githubRepo ?? null,
      prodBranch,
    })
    .where(eq(sites.id, siteId));

  revalidatePath(`/sites/${siteId}`);
  revalidatePath("/");
}

export async function createKeyword(formData: FormData) {
  await requireUser();
  const siteId = requireString(formData, "siteId");
  const phrase = requireString(formData, "phrase");
  const country = optionalString(formData, "country") ?? "de";
  const device = optionalString(formData, "device") === "mobile" ? "mobile" : "desktop";

  await db.insert(keywords).values({
    siteId,
    phrase,
    country,
    device,
    // Append to the end of this site's keyword order.
    sortOrder: sql`(select coalesce(max(${keywords.sortOrder}), -1) + 1 from ${keywords} where ${keywords.siteId} = ${siteId})`,
  });
  revalidatePath(`/sites/${siteId}`);
}

export async function deleteKeyword(keywordId: string, siteId: string) {
  await requireUser();
  await db.delete(keywords).where(eq(keywords.id, keywordId));
  revalidatePath(`/sites/${siteId}`);
}

export async function reorderKeywords(siteId: string, orderedKeywordIds: string[]) {
  await requireUser();
  await db.transaction(async (tx) => {
    await Promise.all(
      orderedKeywordIds.map((keywordId, index) =>
        tx
          .update(keywords)
          .set({ sortOrder: index })
          .where(and(eq(keywords.id, keywordId), eq(keywords.siteId, siteId))),
      ),
    );
  });
  revalidatePath(`/sites/${siteId}`);
}

export async function setSeoWatcher(siteId: string, currentlyEnabled: boolean) {
  await requireUser();
  await db
    .update(sites)
    .set({ seoWatcherEnabled: !currentlyEnabled })
    .where(eq(sites.id, siteId));
  revalidatePath(`/sites/${siteId}`);
}

export interface RankCheckActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

export async function runRankCheckNow(
  siteId: string,
  _prevState: RankCheckActionState,
  _formData: FormData,
): Promise<RankCheckActionState> {
  await requireUser();
  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId) });
  if (!site) throw new Error("site not found");

  const summary = await submitRankChecksForSite(site);
  revalidatePath(`/sites/${siteId}`);

  if (summary.submitted === 0 && summary.skipped === 0 && summary.failed.length === 0) {
    return { status: "success", message: "No active keywords to check." };
  }
  if (summary.failed.length > 0) {
    return {
      status: "error",
      message: `Submitted ${summary.submitted} keyword check(s), ${summary.failed.length} failed: ${summary.failed
        .map((f) => `"${f.keyword}" (${f.error})`)
        .join(", ")}`,
    };
  }
  if (summary.submitted === 0) {
    return { status: "success", message: "Checks already in progress." };
  }
  return {
    status: "success",
    message: `Submitted ${summary.submitted} keyword check${summary.submitted === 1 ? "" : "s"}${
      summary.skipped > 0 ? ` (${summary.skipped} already in progress)` : ""
    } — results appear within ~10 minutes.`,
  };
}

export async function acknowledgeAlert(alertId: string) {
  await requireUser();
  await db.update(alerts).set({ status: "acknowledged" }).where(eq(alerts.id, alertId));
  revalidatePath("/alerts");
  revalidatePath("/");
}

export async function resolveAlertManually(alertId: string) {
  await requireUser();
  await db
    .update(alerts)
    .set({ status: "resolved", resolvedAt: new Date(), resolutionNote: "Resolved manually." })
    .where(eq(alerts.id, alertId));
  revalidatePath("/alerts");
  revalidatePath("/");
}

const PROTECTION_KEY_PATTERN = /^(hsts|nosniff|framing|referrer_policy|permissions_policy|csp:[a-z0-9-]+)$/;

function requireProtectionKey(protectionKey: string) {
  if (!PROTECTION_KEY_PATTERN.test(protectionKey)) {
    throw new Error(`unknown protection key: ${protectionKey}`);
  }
  return protectionKey;
}

/** Re-evaluates the site's latest header run so the alert reflects the changed expectations. */
async function reconcileLatestSecurityHeaderRun(siteId: string) {
  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId) });
  const run = await db.query.securityHeaderCheckRuns.findFirst({
    where: eq(securityHeaderCheckRuns.siteId, siteId),
    orderBy: desc(securityHeaderCheckRuns.checkedAt),
  });
  if (site && run) await reconcileSecurityHeaders(site, run);

  revalidatePath(`/sites/${siteId}`);
  revalidatePath("/alerts");
  revalidatePath("/");
}

export async function disableSecurityProtection(
  siteId: string,
  protectionKey: string,
  formData: FormData,
) {
  const email = await requireUser();
  const key = requireProtectionKey(protectionKey);
  const now = new Date();
  const disabled = {
    status: "disabled" as const,
    updatedAt: now,
    disabledAt: now,
    disabledBy: email,
    disabledNote: optionalString(formData, "note") ?? null,
  };

  await db
    .insert(siteSecurityHeaderExpectations)
    .values({ siteId, protectionKey: key, ...disabled })
    .onConflictDoUpdate({
      target: [siteSecurityHeaderExpectations.siteId, siteSecurityHeaderExpectations.protectionKey],
      set: disabled,
    });

  await reconcileLatestSecurityHeaderRun(siteId);
}

export async function monitorSecurityProtection(siteId: string, protectionKey: string) {
  await requireUser();
  const key = requireProtectionKey(protectionKey);
  await db
    .update(siteSecurityHeaderExpectations)
    .set({
      status: "expected",
      updatedAt: new Date(),
      disabledAt: null,
      disabledBy: null,
      disabledNote: null,
    })
    .where(
      and(
        eq(siteSecurityHeaderExpectations.siteId, siteId),
        eq(siteSecurityHeaderExpectations.protectionKey, key),
      ),
    );

  await reconcileLatestSecurityHeaderRun(siteId);
}
