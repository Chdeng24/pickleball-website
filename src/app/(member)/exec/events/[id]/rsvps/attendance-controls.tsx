"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Minus, X } from "lucide-react";
import { attendanceCopy } from "@/lib/content";
import { markAttendance, markRemainingAsNoShow, clearAttendance } from "./actions";
import type { AttendanceState } from "@/lib/strikes";

/**
 * Three-state toggle per member, sized for a phone held courtside in one hand
 * while people are arriving. Tapping the state it's already in clears it back
 * to unmarked, so a mis-tap is one tap to undo.
 */
export function AttendanceToggle({
  rsvpId,
  attendance,
  disabled,
}: {
  rsvpId: string;
  attendance: AttendanceState;
  disabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function set(next: AttendanceState) {
    startTransition(async () => {
      try {
        const res = await markAttendance(rsvpId, next === attendance ? "unmarked" : next);
        if (!res.ok) toast.error(res.error);
        router.refresh();
      } catch {
        toast.error(attendanceCopy.errors.unknown);
      }
    });
  }

  const base =
    "flex h-10 w-10 items-center justify-center border-2 transition-colors disabled:opacity-40";

  return (
    <div className="flex gap-2" role="group" aria-label="Attendance">
      <button
        type="button"
        disabled={disabled || pending}
        onClick={() => set("present")}
        aria-pressed={attendance === "present"}
        title={attendanceCopy.present}
        className={
          attendance === "present"
            ? `${base} border-green-700 bg-green-700 text-white`
            : `${base} border-navy-900/15 text-ink/40 hover:border-green-700 hover:text-green-700`
        }
      >
        <Check size={18} />
        <span className="sr-only">{attendanceCopy.present}</span>
      </button>
      <button
        type="button"
        disabled={disabled || pending}
        onClick={() => set("no_show")}
        aria-pressed={attendance === "no_show"}
        title={attendanceCopy.noShow}
        className={
          attendance === "no_show"
            ? `${base} border-red-700 bg-red-700 text-white`
            : `${base} border-navy-900/15 text-ink/40 hover:border-red-700 hover:text-red-700`
        }
      >
        <X size={18} />
        <span className="sr-only">{attendanceCopy.noShow}</span>
      </button>
    </div>
  );
}

/** Shown for waitlisted/cancelled rows, which are never marked. */
export function NotMarkable() {
  return (
    <span className="flex h-10 w-[88px] items-center justify-center text-ink/25" title="Not applicable">
      <Minus size={16} />
    </span>
  );
}

export function SessionActions({
  eventId,
  unmarkedCount,
  disabled,
}: {
  eventId: string;
  unmarkedCount: number;
  disabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    startTransition(async () => {
      try {
        const res = await fn();
        if (!res.ok) toast.error(res.error ?? attendanceCopy.errors.unknown);
        else toast.success("Saved.");
        router.refresh();
      } catch {
        toast.error(attendanceCopy.errors.unknown);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={disabled || pending || unmarkedCount === 0}
        onClick={() =>
          run(
            () => markRemainingAsNoShow(eventId),
            `Mark ${unmarkedCount} member(s) as a no-show? Each one is a strike.`,
          )
        }
        className="h-11 bg-navy-900 px-5 font-display text-xs font-bold uppercase tracking-[0.12em] text-gold-500 transition-colors hover:bg-navy-800 disabled:bg-ink/15 disabled:text-ink/40"
      >
        {attendanceCopy.markRemaining}
        {unmarkedCount > 0 && ` (${unmarkedCount})`}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          run(
            () => clearAttendance(eventId),
            "Clear attendance for everyone at this session? Any strikes it created go away too.",
          )
        }
        className="h-11 border-2 border-navy-900/15 px-5 font-display text-xs font-bold uppercase tracking-[0.12em] text-ink/60 transition-colors hover:border-navy-900 hover:text-navy-900"
      >
        {attendanceCopy.clearAll}
      </button>
    </div>
  );
}
