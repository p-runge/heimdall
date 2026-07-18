"use client";

import { useState } from "react";
import { Button, Field, TextInput } from "@/components/ui";

export function EditClientForm({
  client,
  action,
}: {
  client: { name: string; contactEmail: string | null; notes: string | null };
  action: (formData: FormData) => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(formData: FormData) {
    setIsSaving(true);
    try {
      await action(formData);
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  }

  if (!isEditing) {
    return (
      <div>
        <h1 className="mt-2 font-display text-2xl tracking-wide text-mist-100">
          {client.name}
        </h1>
        {client.contactEmail && <p className="mt-1 text-mist-400">{client.contactEmail}</p>}
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="mt-2 text-sm text-mist-500 hover:text-mist-300"
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <form action={handleSubmit} className="mt-2 flex max-w-sm flex-col gap-3">
      <Field label="Name">
        <TextInput name="name" required defaultValue={client.name} />
      </Field>
      <Field label="Contact email">
        <TextInput name="contactEmail" type="email" defaultValue={client.contactEmail ?? ""} />
      </Field>
      <Field label="Notes">
        <TextInput name="notes" defaultValue={client.notes ?? ""} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setIsEditing(false)}
          disabled={isSaving}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
