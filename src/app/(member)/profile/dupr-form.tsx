"use client";

import { useActionState } from "react";
import { ExternalLink } from "lucide-react";
import { updateDuprLink } from "./actions";

export function DuprForm({ initialUrl }: { initialUrl: string | null }) {
  const [state, formAction, pending] = useActionState(updateDuprLink, { ok: true });

  return (
    <div className="border-2 border-navy-900/10 bg-white p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-ink/40">DUPR</p>

      {initialUrl && (
        <a
          href={initialUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 flex items-center gap-1.5 font-display text-lg font-bold text-navy-900 hover:text-gold-600"
        >
          View profile <ExternalLink size={15} />
        </a>
      )}

      <form action={formAction} className="mt-3 flex gap-2">
        <input
          type="text"
          name="duprUrl"
          defaultValue={initialUrl ?? ""}
          placeholder="https://mydupr.com/player/123456"
          className="h-10 w-full min-w-0 border-2 border-navy-900/15 bg-chalk px-3 text-sm text-navy-900 outline-none focus:border-navy-800"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-10 shrink-0 border-2 border-navy-800 bg-navy-800 px-4 font-display text-xs font-bold uppercase tracking-wide text-white transition-colors hover:bg-navy-700 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </form>

      {state.error && <p className="mt-2 text-xs text-red-600">{state.error}</p>}
      <p className="mt-2 text-xs text-ink/40">
        Paste the link to your public DUPR profile. Leave blank and save to remove it.
      </p>
    </div>
  );
}
