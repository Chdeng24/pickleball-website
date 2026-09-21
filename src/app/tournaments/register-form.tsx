"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { registerTeam, type ActionResult } from "./actions";

const initialState: ActionResult = { ok: false };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-10 shrink-0 bg-navy-900 px-5 font-display text-xs font-bold uppercase tracking-wide text-white transition-colors hover:bg-navy-800 disabled:opacity-50"
    >
      {pending ? "Signing up…" : "Sign up"}
    </button>
  );
}

export function RegisterForm({ tournamentId, leagueName }: { tournamentId: string; leagueName: string }) {
  const [state, action] = useActionState(registerTeam, initialState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-11 bg-gold-500 px-6 font-display text-xs font-bold uppercase tracking-[0.12em] text-navy-900 transition-colors hover:bg-gold-400"
      >
        Sign up for the {leagueName}
      </button>
    );
  }

  return (
    <form action={action} className="space-y-4 border-2 border-navy-900/10 bg-chalk p-4">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">
          Partner&apos;s email <span className="normal-case text-ink/40">(optional)</span>
        </label>
        <input
          type="email"
          name="partnerEmail"
          placeholder="partner@berkeley.edu"
          autoComplete="off"
          className="mt-1 h-10 w-full border-2 border-navy-900/15 bg-white px-3 text-sm text-navy-900 focus:border-navy-800"
        />
        <p className="mt-1 text-xs text-ink/50">
          They need to have signed in to the site once. No partner yet? Leave it blank — you can add one
          later, or exec will pair you with another solo player.
        </p>
      </div>
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">
          Team name <span className="normal-case text-ink/40">(optional)</span>
        </label>
        <input
          name="teamName"
          maxLength={60}
          className="mt-1 h-10 w-full border-2 border-navy-900/15 bg-white px-3 text-sm text-navy-900 focus:border-navy-800"
        />
      </div>
      {state.error && <p className="border-l-4 border-red-500 bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}
      <div className="flex gap-3">
        <SubmitButton />
        <button type="button" onClick={() => setOpen(false)} className="h-10 px-3 text-xs font-bold uppercase text-ink/50">
          Cancel
        </button>
      </div>
    </form>
  );
}
