"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { invitePartnerAction, leaveLeagueAction, type ActionResult } from "./actions";

const initialState: ActionResult = { ok: false };

function InviteSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-10 shrink-0 bg-navy-900 px-4 text-xs font-bold uppercase text-white hover:bg-navy-800 disabled:opacity-50"
    >
      {pending ? "Sending…" : "Invite"}
    </button>
  );
}

/** For a team with no partner yet — or whose invite was declined or never answered. */
export function InvitePartnerForm({ teamId, replacing }: { teamId: string; replacing: boolean }) {
  const [state, action] = useActionState(invitePartnerAction, initialState);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="teamId" value={teamId} />
      <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">
        {replacing ? "Invite someone else instead" : "Invite a partner"}
      </label>
      <div className="flex gap-2">
        <input
          type="email"
          name="partnerEmail"
          required
          placeholder="partner@berkeley.edu"
          autoComplete="off"
          className="h-10 w-full min-w-0 border-2 border-navy-900/15 bg-white px-3 text-sm text-navy-900 focus:border-navy-800"
        />
        <InviteSubmit />
      </div>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      {state.ok && state.message && <p className="text-sm text-navy-800">{state.message}</p>}
    </form>
  );
}

export function LeaveLeagueButton({ teamId, hasPartner }: { teamId: string; hasPartner: boolean }) {
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (!armed) {
    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setArmed(true);
          }}
          className="text-xs font-bold uppercase text-ink/45 underline underline-offset-2 hover:text-red-600"
        >
          Leave this league
        </button>
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
    );
  }

  return (
    <div className="border-2 border-red-200 bg-red-50 p-3">
      <p className="text-sm text-navy-900">
        {hasPartner
          ? "Leave the league? Your partner keeps the spot and can pick up someone new."
          : "Leave the league? Your spot opens up for someone else."}
      </p>
      <div className="mt-2 flex gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await leaveLeagueAction(teamId);
              setArmed(false);
              if (!res.ok) setError(res.error ?? "Something went wrong.");
              else router.refresh();
            })
          }
          className="h-9 bg-red-600 px-4 text-xs font-bold uppercase text-white hover:bg-red-700 disabled:opacity-50"
        >
          {pending ? "Leaving…" : "Leave"}
        </button>
        <button type="button" onClick={() => setArmed(false)} className="h-9 px-3 text-xs font-bold uppercase text-ink/50">
          Stay
        </button>
      </div>
    </div>
  );
}
