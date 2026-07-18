import { Panel } from "@/components/ui";

function PanelSkeleton() {
  return (
    <Panel>
      <div className="h-4 w-24 animate-pulse rounded bg-mist-800" />
      <div className="mt-4 h-4 w-32 animate-pulse rounded bg-mist-800" />
    </Panel>
  );
}

export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="h-4 w-20 animate-pulse rounded bg-mist-800" />
      <div className="mt-3 h-8 w-64 animate-pulse rounded bg-mist-800" />

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <PanelSkeleton />
        <PanelSkeleton />
        <PanelSkeleton />
        <PanelSkeleton />
      </div>
    </div>
  );
}
