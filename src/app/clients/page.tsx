import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { createClient } from "@/lib/actions";
import { Button, Field, Panel, TextInput } from "@/components/ui";

export default async function ClientsPage() {
  const allClients = await db.query.clients.findMany({
    orderBy: desc(clients.createdAt),
    with: { sites: true },
  });

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="font-display text-2xl tracking-wide text-mist-100">Clients</h1>
      <p className="mt-2 text-mist-300">
        Everyone whose sites you keep watch over.
      </p>

      <div className="mt-8 grid gap-8 md:grid-cols-[2fr_1fr]">
        <div className="space-y-3">
          {allClients.length === 0 && (
            <Panel className="text-mist-500">No clients yet.</Panel>
          )}
          {allClients.map((client) => (
            <Link key={client.id} href={`/clients/${client.id}`}>
              <Panel className="hover:border-aurora-violet/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-mist-100">{client.name}</div>
                    {client.contactEmail && (
                      <div className="text-sm text-mist-500">{client.contactEmail}</div>
                    )}
                  </div>
                  <span className="text-sm text-mist-500">
                    {client.sites.length} site{client.sites.length === 1 ? "" : "s"}
                  </span>
                </div>
              </Panel>
            </Link>
          ))}
        </div>

        <Panel>
          <h2 className="font-display text-lg tracking-wide text-mist-100">
            New client
          </h2>
          <form action={createClient} className="mt-4 flex flex-col gap-4">
            <Field label="Name">
              <TextInput name="name" required placeholder="Acme GmbH" />
            </Field>
            <Field label="Contact email">
              <TextInput
                name="contactEmail"
                type="email"
                placeholder="hello@acme.com"
              />
            </Field>
            <Field label="Notes">
              <TextInput name="notes" placeholder="Optional" />
            </Field>
            <Button type="submit">Add client</Button>
          </form>
        </Panel>
      </div>
    </div>
  );
}
