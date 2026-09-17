"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createSocialLeagueTournament, type ActionResult } from "./actions";

const initialState: ActionResult = { ok: false };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 bg-navy-900 px-7 font-display text-xs font-bold uppercase tracking-[0.12em] text-white transition-colors hover:bg-navy-800 disabled:opacity-50"
    >
      {pending ? "Creating…" : "Create"}
    </button>
  );
}

export function CreateTournamentForm() {
  const [state, action] = useActionState(createSocialLeagueTournament, initialState);

  return (
    <form action={action} className="grid gap-5 pt-5 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">Name</label>
        <input
          name="name"
          defaultValue="Pickleball League"
          className="h-11 w-full border-2 border-navy-900/15 bg-white px-3 text-sm text-ink focus:border-navy-800"
        />
      </div>

      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">Division</label>
        <select
          name="division"
          className="h-11 w-full border-2 border-navy-900/15 bg-white px-3 text-sm text-ink focus:border-navy-800"
        >
          <option value="beginner">Beginner</option>
          <option value="advanced">Advanced</option>
        </select>
      </div>

      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">Who can join</label>
        <select
          name="eligibility"
          className="h-11 w-full border-2 border-navy-900/15 bg-white px-3 text-sm text-ink focus:border-navy-800"
        >
          <option value="all">All members</option>
          <option value="competitive_only">Competitive Team only</option>
        </select>
      </div>

      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">Pool size</label>
        <input
          type="number"
          name="poolSize"
          defaultValue={8}
          min={3}
          max={16}
          className="h-11 w-full border-2 border-navy-900/15 bg-white px-3 text-sm text-ink focus:border-navy-800"
        />
      </div>

      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">Advance per pool</label>
        <input
          type="number"
          name="advancePerPool"
          defaultValue={3}
          min={1}
          max={8}
          className="h-11 w-full border-2 border-navy-900/15 bg-white px-3 text-sm text-ink focus:border-navy-800"
        />
      </div>

      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">
          Registration closes (Pacific, optional)
        </label>
        <input
          type="datetime-local"
          name="registrationClosesAt"
          className="h-11 w-full border-2 border-navy-900/15 bg-white px-3 text-sm text-ink focus:border-navy-800"
        />
      </div>

      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">
          Score dispute window (hours)
        </label>
        <input
          type="number"
          name="autoconfirmHours"
          defaultValue={24}
          min={1}
          max={168}
          className="h-11 w-full border-2 border-navy-900/15 bg-white px-3 text-sm text-ink focus:border-navy-800"
        />
      </div>

      {state.error && <p className="text-sm text-red-600 sm:col-span-2">{state.error}</p>}

      <div className="sm:col-span-2">
        <SubmitButton />
      </div>
    </form>
  );
}
