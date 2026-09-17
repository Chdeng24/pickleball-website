"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCompetitiveTeam } from "../actions";

export function CompetitiveToggle({ memberId, on }: { memberId: string; on: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <label className="flex items-center gap-2 text-sm text-navy-900">
      <input
        type="checkbox"
        defaultChecked={on}
        disabled={pending}
        onChange={(e) =>
          startTransition(async () => {
            await setCompetitiveTeam(memberId, e.target.checked);
            router.refresh();
          })
        }
        className="h-4 w-4"
      />
      On Competitive Team
    </label>
  );
}
