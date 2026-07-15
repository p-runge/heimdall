"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { alerts, clients, environmentBranchMappings, keywords, sites } from "@/db/schema";

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
