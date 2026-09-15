"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteEvent, togglePublished } from "./actions";

export function EventRowActions({ id, published }: { id: string; published: boolean }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {error && <span className="w-full text-right text-xs text-red-600">{error}</span>}

      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await togglePublished(id, !published);
            if (!res.ok) setError(res.error ?? "Failed to update.");
            else router.refresh();
          })
        }
        className="h-8 border-2 border-navy-900/15 px-3 text-xs font-bold uppercase tracking-wide text-ink/70 transition-colors hover:border-navy-900"
      >
        {published ? "Unpublish" : "Publish"}
      </button>

      {confirmingDelete ? (
        <>
          <span className="text-xs text-ink/60">Delete for good?</span>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await deleteEvent(id);
                if (!res.ok) {
                  setError(res.error ?? "Failed to delete.");
                  setConfirmingDelete(false);
                } else {
                  router.refresh();
                }
              })
            }
            className="h-8 bg-red-600 px-3 text-xs font-bold uppercase tracking-wide text-white hover:bg-red-700"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            className="h-8 px-3 text-xs font-bold uppercase tracking-wide text-ink/50"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          className="h-8 border-2 border-red-300 px-3 text-xs font-bold uppercase tracking-wide text-red-600 transition-colors hover:border-red-600"
        >
          Delete
        </button>
      )}
    </div>
  );
}
