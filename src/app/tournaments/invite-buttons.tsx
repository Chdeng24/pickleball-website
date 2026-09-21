"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { respondToInviteAction } from "./actions";
import { safeAction } from "./safe-action";

const safeRespond = safeAction(respondToInviteAction);

export function InviteButtons({ teamId }: { teamId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const respond = (accept: boolean) =>
    startTransition(async () => {
      setError(null);
      const res = await safeRespond(teamId, accept);
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else router.refresh();
    });

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => respond(true)}
          className="h-10 bg-navy-900 px-5 text-xs font-bold uppercase text-white hover:bg-navy-800 disabled:opacity-50"
        >
          Accept
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => respond(false)}
          className="h-10 border-2 border-navy-900/15 px-5 text-xs font-bold uppercase text-ink/60 hover:border-navy-900 disabled:opacity-50"
        >
          Decline
        </button>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
