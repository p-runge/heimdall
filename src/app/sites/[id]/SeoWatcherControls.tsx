"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import type { RankCheckActionState } from "@/lib/actions";

const initialState: RankCheckActionState = { status: "idle" };

export function SeoWatcherControls({
  checkAction,
  toggleAction,
  watcherEnabled,
  checkDisabled,
}: {
  checkAction: (prevState: RankCheckActionState, formData: FormData) => Promise<RankCheckActionState>;
  toggleAction: (formData: FormData) => void | Promise<void>;
  watcherEnabled: boolean;
  checkDisabled: boolean;
}) {
  const [state, checkFormAction, checking] = useActionState(checkAction, initialState);

  // The status message renders below the button row (not inside it), so it can
  // grow without shifting the buttons.
  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <form action={checkFormAction}>
          <Button variant="ghost" type="submit" disabled={checkDisabled || checking}>
            {checking ? "Submitting…" : "Check once"}
          </Button>
        </form>
        <form action={toggleAction}>
          <SubmitButton variant={watcherEnabled ? "danger" : "primary"} pendingText="Saving…">
            {watcherEnabled ? "Stop watching" : "Start watching"}
          </SubmitButton>
        </form>
      </div>
      {state.status !== "idle" && !checking && (
        <p
          className={`max-w-xs text-right text-xs ${
            state.status === "error" ? "text-crimson" : "text-mist-500"
          }`}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
