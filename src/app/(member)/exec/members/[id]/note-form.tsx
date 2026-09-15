"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { addMemberNote } from "../actions";

export function NoteForm({ memberId }: { memberId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        const res = await addMemberNote(formData);
        if (res.ok) {
          formRef.current?.reset();
          router.refresh();
        }
      }}
      className="space-y-3"
    >
      <input type="hidden" name="memberId" value={memberId} />
      <textarea
        name="body"
        rows={3}
        placeholder="Note visible to exec only — e.g. skill observations, comp team candidacy…"
        className="w-full border-2 border-navy-900/15 bg-white p-3 text-sm"
        required
      />
      <button
        type="submit"
        className="h-10 bg-navy-900 px-5 font-display text-xs font-bold uppercase tracking-wide text-white"
      >
        Add note
      </button>
    </form>
  );
}
