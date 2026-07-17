"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { alerts, clients, environmentBranchMappings, keywords, sites } from "@/db/schema";
import { runHealthCheck } from "@/checks/health";
import { runRankCheckNowForSite } from "@/checks/rank";

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

export async function createClient(formData: FormData) {
  const name = requireString(formData, "name");
  const contactEmail = optionalString(formData, "contactEmail");
  const notes = optionalString(formData, "notes");

  await db.insert(clients).values({ name, contactEmail, notes });
  revalidatePath("/clients");
}

export async function deleteClient(clientId: string) {
  await db.delete(clients).where(eq(clients.id, clientId));
  revalidatePath("/clients");
  redirect("/clients");
}

export async function updateClient(clientId: string, formData: FormData) {
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
  const clientId = requireString(formData, "clientId");
  const name = requireString(formData, "name");
  const primaryUrl = requireString(formData, "primaryUrl");
  const previewUrl = optionalString(formData, "previewUrl");
  const githubOwner = optionalString(formData, "githubOwner");
  const githubRepo = optionalString(formData, "githubRepo");
  const prodBranch = optionalString(formData, "prodBranch") ?? "main";
  const compareBranch = optionalString(formData, "compareBranch");

  const [site] = await db
    .insert(sites)
    .values({ clientId, name, primaryUrl, previewUrl, githubOwner, githubRepo })
    .returning();

  // Run the first health check right away rather than waiting for the next
  // scheduled tick. runHealthCheck never throws on network failure (a down
  // site just yields an isUp:false row); only a genuine bug would land here.
  try {
    await runHealthCheck(site);
  } catch (err) {
    console.error(`initial health check failed for site ${site.id}:`, err);
  }

  if (githubOwner && githubRepo) {
    await db.insert(environmentBranchMappings).values({
      siteId: site.id,
      envName: "production",
      branchName: prodBranch,
      isProdBranch: true,
    });

    if (compareBranch) {
      await db.insert(environmentBranchMappings).values({
        siteId: site.id,
        envName: "compare",
        branchName: compareBranch,
        isProdBranch: false,
      });
    }
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/");
}

export async function deleteSite(siteId: string, clientId: string) {
  await db.delete(sites).where(eq(sites.id, siteId));
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/");
  redirect(`/clients/${clientId}`);
}

export async function updateSite(siteId: string, formData: FormData) {
  const name = requireString(formData, "name");
  const primaryUrl = requireString(formData, "primaryUrl");
  const previewUrl = optionalString(formData, "previewUrl");
  const githubOwner = optionalString(formData, "githubOwner");
  const githubRepo = optionalString(formData, "githubRepo");

  await db
    .update(sites)
    .set({
      name,
      primaryUrl,
      previewUrl: previewUrl ?? null,
      githubOwner: githubOwner ?? null,
      githubRepo: githubRepo ?? null,
    })
    .where(eq(sites.id, siteId));
  revalidatePath(`/sites/${siteId}`);
  revalidatePath("/");
}

export async function createKeyword(formData: FormData) {
  const siteId = requireString(formData, "siteId");
  const phrase = requireString(formData, "phrase");
  const country = optionalString(formData, "country") ?? "de";
  const device = optionalString(formData, "device") === "mobile" ? "mobile" : "desktop";

  await db.insert(keywords).values({ siteId, phrase, country, device });
  revalidatePath(`/sites/${siteId}`);
}

export async function deleteKeyword(keywordId: string, siteId: string) {
  await db.delete(keywords).where(eq(keywords.id, keywordId));
  revalidatePath(`/sites/${siteId}`);
}

export async function setSeoWatcher(siteId: string, currentlyEnabled: boolean) {
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
  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId) });
  if (!site) throw new Error("site not found");

  const summary = await runRankCheckNowForSite(site);
  revalidatePath(`/sites/${siteId}`);

  if (summary.checked === 0 && summary.failed.length === 0) {
    return { status: "success", message: "No active keywords to check." };
  }
  if (summary.failed.length > 0) {
    return {
      status: "error",
      message: `Checked ${summary.checked} keyword(s), ${summary.failed.length} failed: ${summary.failed
        .map((f) => `"${f.keyword}" (${f.error})`)
        .join(", ")}`,
    };
  }
  return {
    status: "success",
    message: `Checked ${summary.checked} keyword${summary.checked === 1 ? "" : "s"}.`,
  };
}

export async function acknowledgeAlert(alertId: string) {
  await db.update(alerts).set({ status: "acknowledged" }).where(eq(alerts.id, alertId));
  revalidatePath("/alerts");
  revalidatePath("/");
}

export async function resolveAlertManually(alertId: string) {
  await db
    .update(alerts)
    .set({ status: "resolved", resolvedAt: new Date(), resolutionNote: "Resolved manually." })
    .where(eq(alerts.id, alertId));
  revalidatePath("/alerts");
  revalidatePath("/");
}
