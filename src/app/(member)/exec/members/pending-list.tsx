"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveMembers, approveMember, blockMember } from "./actions";

type PendingUser = { id: string; name: string | null; email: string; createdAt: Date };

export function PendingList({ users }: { users: PendingUser[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (users.length === 0) {
    return (
      <p className="border-2 border-dashed border-navy-900/15 bg-white p-8 text-center text-sm text-ink/50">
        No one is waiting for approval.
      </p>
    );
  }

  return (
    <div className="border-2 border-navy-900/10 bg-white">
      <div className="flex items-center justify-between border-b-2 border-navy-900/10 p-4">
        <p className="text-sm text-ink/60">{selected.size} selected</p>
        <button
          type="button"
          disabled={selected.size === 0 || pending}
          onClick={() =>
            startTransition(async () => {
              await approveMembers({ memberIds: [...selected] });
              setSelected(new Set());
              router.refresh();
            })
          }
          className="h-9 bg-navy-900 px-4 text-xs font-bold uppercase tracking-wide text-white disabled:opacity-40"
        >
          Approve selected
        </button>
      </div>

      <ul className="divide-y divide-navy-900/5">
        {users.map((u) => (
          <li key={u.id} className="flex items-center gap-4 p-4">
            <input
              type="checkbox"
              checked={selected.has(u.id)}
              onChange={() => toggle(u.id)}
              className="h-4 w-4"
            />
            <div className="flex-1">
              <p className="text-sm font-semibold text-navy-900">{u.name ?? u.email}</p>
              <p className="text-xs text-ink/50">
                {u.email} · signed up {u.createdAt.toLocaleDateString("en-US")}
              </p>
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => startTransition(async () => { await approveMember(u.id); router.refresh(); })}
              className="h-8 border-2 border-navy-900 px-3 text-xs font-bold uppercase tracking-wide text-navy-900"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => startTransition(async () => { await blockMember(u.id); router.refresh(); })}
              className="h-8 border-2 border-red-300 px-3 text-xs font-bold uppercase tracking-wide text-red-600"
            >
              Block
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
