"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setMemberRole } from "../actions";

export function RoleSelect({
  memberId,
  role,
}: {
  memberId: string;
  role: "member" | "exec" | "admin";
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <select
      defaultValue={role}
      disabled={pending}
      onChange={(e) =>
        startTransition(async () => {
          await setMemberRole({ memberId, role: e.target.value });
          router.refresh();
        })
      }
      className="h-9 border-2 border-navy-900/15 bg-white px-2 text-sm capitalize"
    >
      <option value="member">Member</option>
      <option value="exec">Exec</option>
      <option value="admin">Admin</option>
    </select>
  );
}
