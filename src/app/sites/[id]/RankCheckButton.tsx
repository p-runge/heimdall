"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import type { RankCheckActionState } from "@/lib/actions";

const initialState: RankCheckActionState = { status: "idle" };

export function RankCheckButton({
  action,
  disabled,
}: {
  action: (prevState: RankCheckActionState, formData: FormData) => Promise<RankCheckActionState>;
  disabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <Button variant="ghost" type="submit" disabled={disabled || pending}>
        {pending ? "Checking…" : "Run check now"}
      </Button>
      {state.status !== "idle" && !pending && (
        <span
          className={`max-w-xs text-right text-xs ${
            state.status === "error" ? "text-crimson" : "text-mist-500"
          }`}
        >
          {state.message}
        </span>
      )}
    </form>
  );
}
