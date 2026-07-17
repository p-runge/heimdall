import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { createSite, deleteClient, updateClient } from "@/lib/actions";
import { Badge, Button, Field, Panel, TextInput } from "@/components/ui";
import { EditClientForm } from "./EditClientForm";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await db.query.clients.findFirst({
    where: eq(clients.id, id),
    with: { sites: true },
  });

  if (!client) notFound();

  const deleteClientWithId = deleteClient.bind(null, client.id);
  const updateClientWithId = updateClient.bind(null, client.id);

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/clients" className="text-sm text-mist-500 hover:text-mist-300">
            &larr; Clients
          </Link>
          <EditClientForm client={client} action={updateClientWithId} />
        </div>
        <form action={deleteClientWithId}>
          <Button variant="danger" type="submit">
            Delete client
          </Button>
        </form>
      </div>

      <div className="mt-10 grid gap-8 md:grid-cols-[2fr_1fr]">
        <div className="space-y-3">
          <h2 className="font-display text-lg tracking-wide text-mist-100">Sites</h2>
          {client.sites.length === 0 && (
            <Panel className="text-mist-500">No sites yet.</Panel>
          )}
          {client.sites.map((site) => (
            <Link key={site.id} href={`/sites/${site.id}`}>
              <Panel className="hover:border-aurora-violet/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-mist-100">{site.name}</div>
                    <div className="text-sm text-mist-500">{site.primaryUrl}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {site.githubRepo && (
                      <Badge tone="aurora">
                        {site.githubOwner}/{site.githubRepo}
                      </Badge>
                    )}
                    <Badge tone={site.isActive ? "neutral" : "crimson"}>
                      {site.isActive ? "active" : "paused"}
                    </Badge>
                  </div>
                </div>
              </Panel>
            </Link>
          ))}
        </div>

        <Panel>
          <h2 className="font-display text-lg tracking-wide text-mist-100">
            New site
          </h2>
          <form action={createSite} className="mt-4 flex flex-col gap-4">
            <input type="hidden" name="clientId" value={client.id} />
            <Field label="Name">
              <TextInput name="name" required placeholder="Marketing site" />
            </Field>
            <Field label="Primary URL">
              <TextInput
                name="primaryUrl"
                required
                type="url"
                placeholder="https://acme.com"
              />
            </Field>
            <Field label="Preview URL (optional)">
              <TextInput
                name="previewUrl"
                type="url"
                placeholder="https://staging.acme.com"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="GitHub owner">
                <TextInput name="githubOwner" placeholder="acme-inc" />
              </Field>
              <Field label="GitHub repo">
                <TextInput name="githubRepo" placeholder="marketing-site" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Production branch">
                <TextInput name="prodBranch" placeholder="main" />
              </Field>
              <Field label="Compare branch (optional)">
                <TextInput name="compareBranch" placeholder="develop" />
              </Field>
            </div>
            <Button type="submit">Add site</Button>
          </form>
        </Panel>
      </div>
    </div>
  );
}
