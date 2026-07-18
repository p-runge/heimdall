"use client";

import { useState } from "react";
import { Button, Field, TextInput } from "@/components/ui";

export function EditSiteForm({
  site,
  action,
}: {
  site: {
    name: string;
    primaryUrl: string;
    previewUrl: string | null;
    githubOwner: string | null;
    githubRepo: string | null;
    prodBranch: string | null;
  };
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
        <h1 className="mt-2 font-display text-2xl tracking-wide text-mist-100">{site.name}</h1>
        <a
          href={site.primaryUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-mist-400 hover:text-aurora-teal"
        >
          {site.primaryUrl}
        </a>
        <div>
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="mt-2 text-sm text-mist-500 hover:text-mist-300"
          >
            Edit
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={handleSubmit} className="mt-2 flex max-w-sm flex-col gap-3">
      <Field label="Name">
        <TextInput name="name" required defaultValue={site.name} />
      </Field>
      <Field label="Primary URL">
        <TextInput name="primaryUrl" required defaultValue={site.primaryUrl} />
      </Field>
      <Field label="Preview URL (optional)">
        <TextInput name="previewUrl" defaultValue={site.previewUrl ?? ""} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="GitHub owner">
          <TextInput name="githubOwner" defaultValue={site.githubOwner ?? ""} />
        </Field>
        <Field label="GitHub repo">
          <TextInput name="githubRepo" defaultValue={site.githubRepo ?? ""} />
        </Field>
      </div>
      <Field label="Production branch">
        <TextInput name="prodBranch" placeholder="main" defaultValue={site.prodBranch ?? ""} />
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
