import { AlertTriangle } from "lucide-react";
import { STRIKE_LIMIT, strikeState } from "@/lib/strikes";
import { attendanceCopy } from "@/lib/content";

/**
 * EXEC-ONLY. Strikes are never shown to the member they belong to — every page
 * that renders this is behind `requireExec()`.
 */
export function StrikeBadge({ strikes, showClear = false }: { strikes: number; showClear?: boolean }) {
  const state = strikeState(strikes);

  if (state === "clear") {
    return showClear ? <span className="text-xs text-ink/35">—</span> : null;
  }

  if (state === "flagged") {
    return (
      <span
        className="inline-flex items-center gap-1.5 bg-red-700 px-2 py-1 text-xs font-bold uppercase tracking-wide text-white"
        title={attendanceCopy.flagged}
      >
        <AlertTriangle size={13} />
        {strikes}/{STRIKE_LIMIT} {attendanceCopy.strikes}
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 border-2 border-red-700/30 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-red-800"
      title={attendanceCopy.warning}
    >
      {strikes}/{STRIKE_LIMIT} {attendanceCopy.strikes}
    </span>
  );
}
