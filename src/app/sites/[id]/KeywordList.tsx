"use client";

import { useState, useTransition } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export interface KeywordListItem {
  id: string;
  phrase: string;
  country: string;
  device: string;
  label: string;
  tone: "neutral" | "gold" | "crimson" | "aurora";
  checkedTitle?: string;
  deleteAction: (formData: FormData) => void | Promise<void>;
}

export function KeywordList({
  siteId,
  keywords,
  reorderAction,
}: {
  siteId: string;
  keywords: KeywordListItem[];
  reorderAction: (siteId: string, orderedKeywordIds: string[]) => Promise<void>;
}) {
  const [items, setItems] = useState(keywords);
  const [, startTransition] = useTransition();

  // Reset local state during render (not in an effect) whenever the server
  // hands us a new keywords array — e.g. after add/delete/rank check. A
  // drag-triggered reorder updates `items` directly, outside of this path.
  const [prevKeywords, setPrevKeywords] = useState(keywords);
  if (keywords !== prevKeywords) {
    setPrevKeywords(keywords);
    setItems(keywords);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((k) => k.id === active.id);
    const newIndex = items.findIndex((k) => k.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(items, oldIndex, newIndex);
    setItems(reordered);
    startTransition(() => {
      reorderAction(
        siteId,
        reordered.map((k) => k.id),
      );
    });
  }

  return (
    <DndContext
      id={`keyword-list-${siteId}`}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={items.map((k) => k.id)} strategy={verticalListSortingStrategy}>
        <div className="mt-3 space-y-2">
          {items.map((keyword) => (
            <SortableKeywordRow key={keyword.id} keyword={keyword} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableKeywordRow({ keyword }: { keyword: KeywordListItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: keyword.id,
  });

  return (
    <Panel
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center justify-between gap-3 ${isDragging ? "relative z-10 opacity-60" : ""}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          className="shrink-0 cursor-grab touch-none text-mist-600 hover:text-mist-300 active:cursor-grabbing"
          aria-label={`Reorder ${keyword.phrase}`}
          {...attributes}
          {...listeners}
        >
          <DragHandleIcon />
        </button>
        <div className="min-w-0">
          <div className="truncate text-mist-100">{keyword.phrase}</div>
          <div className="text-xs text-mist-500">
            {keyword.country.toUpperCase()} &middot; {keyword.device}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Badge tone={keyword.tone} title={keyword.checkedTitle}>
          {keyword.label}
        </Badge>
        <form action={keyword.deleteAction}>
          <SubmitButton variant="ghost" className="px-2 py-1 text-xs" pendingText="Removing…">
            remove
          </SubmitButton>
        </form>
      </div>
    </Panel>
  );
}

function DragHandleIcon() {
  return (
    <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="2" r="1.4" />
      <circle cx="9" cy="2" r="1.4" />
      <circle cx="3" cy="8" r="1.4" />
      <circle cx="9" cy="8" r="1.4" />
      <circle cx="3" cy="14" r="1.4" />
      <circle cx="9" cy="14" r="1.4" />
    </svg>
  );
}
