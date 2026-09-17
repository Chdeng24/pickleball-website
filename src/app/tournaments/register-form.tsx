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
      className="h-10 shrink-0 border-2 border-navy-800 bg-navy-800 px-5 font-display text-xs font-bold uppercase tracking-wide text-white transition-colors hover:bg-navy-700 disabled:opacity-50"
    >
      {pending ? "Registering…" : "Register"}
    </button>
  );
}

export function RegisterForm({ tournamentId }: { tournamentId: string }) {
  const [state, action] = useActionState(registerTeam, initialState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-10 border-2 border-navy-800 bg-navy-800 px-5 font-display text-xs font-bold uppercase tracking-wide text-white transition-colors hover:bg-navy-700"
      >
        Register a team
      </button>
    );
  }

  return (
    <form action={action} className="mt-3 space-y-3 border-2 border-navy-900/10 bg-white p-4">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">Team name (optional)</label>
        <input
          name="teamName"
          className="mt-1 h-10 w-full border-2 border-navy-900/15 bg-chalk px-3 text-sm text-navy-900 focus:border-navy-800"
        />
      </div>
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">
          Partner&apos;s email (leave blank to join the free-agent pool)
        </label>
        <input
          type="email"
          name="partnerEmail"
          placeholder="partner@berkeley.edu"
          className="mt-1 h-10 w-full border-2 border-navy-900/15 bg-chalk px-3 text-sm text-navy-900 focus:border-navy-800"
        />
        <p className="mt-1 text-xs text-ink/40">
          They need an account on the site already — send them the login link first if they&apos;re new.
        </p>
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div className="flex gap-3">
        <SubmitButton />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-10 px-3 text-xs font-bold uppercase text-ink/50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
