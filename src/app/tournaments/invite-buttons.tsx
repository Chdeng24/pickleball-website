"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { respondToInvite } from "./actions";

export function InviteButtons({ teamId }: { teamId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => { await respondToInvite(teamId, true); router.refresh(); })}
        className="h-9 bg-navy-900 px-4 text-xs font-bold uppercase text-white hover:bg-navy-800 disabled:opacity-50"
      >
        Accept
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => { await respondToInvite(teamId, false); router.refresh(); })}
        className="h-9 border-2 border-navy-900/15 px-4 text-xs font-bold uppercase text-ink/60 hover:border-navy-900"
      >
        Decline
      </button>
    </div>
  );
}
