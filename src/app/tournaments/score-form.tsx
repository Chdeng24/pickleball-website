"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { reportScore, disputeScore, confirmScore, skipMatch, postMatchTime, type ActionResult } from "./actions";
import { safeAction } from "./safe-action";

const initialState: ActionResult = { ok: false };
const safeReportScore = safeAction(reportScore);
const safeDisputeScore = safeAction(disputeScore);
const safeConfirmScore = safeAction(confirmScore);
const safeSkipMatch = safeAction(skipMatch);

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-9 bg-navy-900 px-4 text-xs font-bold uppercase text-white hover:bg-navy-800 disabled:opacity-50"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

export function ScoreReportForm({ matchId, teamAName, teamBName }: { matchId: string; teamAName: string; teamBName: string }) {
  const [state, formAction] = useActionState(safeReportScore, initialState);
  const [open, setOpen] = useState(false);
  const [games, setGames] = useState([
    ["", ""],
    ["", ""],
    ["", ""],
  ]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-9 border-2 border-navy-900/15 px-4 text-xs font-bold uppercase text-navy-900 hover:border-navy-900"
      >
        Report score
      </button>
    );
  }

  const submit = (formData: FormData) => {
    const parsed = games
      .filter(([a, b]) => a !== "" && b !== "")
      .map(([a, b]) => [Number(a), Number(b)]);
    formData.set("games", JSON.stringify(parsed));
    formData.set("matchId", matchId);
    return formAction(formData);
  };

  return (
    <form action={submit} className="mt-2 space-y-3 border-2 border-navy-900/10 bg-white p-4">
      <p className="text-xs font-semibold uppercase text-ink/50">
        {teamAName} vs {teamBName} — enter each game (leave the 3rd blank if only 2 were played)
      </p>
      {games.map((g, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-14 text-xs text-ink/50">Game {i + 1}</span>
          <input
            type="number"
            min={0}
            value={g[0]}
            onChange={(e) => setGames((prev) => prev.map((row, ri) => (ri === i ? [e.target.value, row[1]] : row)))}
            className="h-9 w-16 border-2 border-navy-900/15 bg-chalk px-2 text-sm"
            placeholder="0"
          />
          <span className="text-ink/40">–</span>
          <input
            type="number"
            min={0}
            value={g[1]}
            onChange={(e) => setGames((prev) => prev.map((row, ri) => (ri === i ? [row[0], e.target.value] : row)))}
            className="h-9 w-16 border-2 border-navy-900/15 bg-chalk px-2 text-sm"
            placeholder="0"
          />
        </div>
      ))}
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div className="flex gap-3">
        <SubmitButton label="Submit score" />
        <button type="button" onClick={() => setOpen(false)} className="h-9 px-3 text-xs font-bold uppercase text-ink/50">
          Cancel
        </button>
      </div>
    </form>
  );
}

export function DisputeScoreButton({ matchId }: { matchId: string }) {
  const [state, formAction] = useActionState(safeDisputeScore, initialState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-bold uppercase text-red-600 underline underline-offset-2"
      >
        That&apos;s not right
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-2 space-y-2 border-2 border-red-300 bg-red-50 p-3">
      <input type="hidden" name="matchId" value={matchId} />
      <textarea
        name="reason"
        rows={2}
        placeholder="What's wrong with this score?"
        className="w-full border-2 border-red-300 bg-white p-2 text-sm"
      />
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      <div className="flex gap-3">
        <SubmitButton label="Dispute" />
        <button type="button" onClick={() => setOpen(false)} className="text-xs font-bold uppercase text-ink/50">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The other team agrees with the reported score. */
export function ConfirmScoreButton({ matchId }: { matchId: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await safeConfirmScore(matchId);
            setResult(res);
            if (res.ok) router.refresh();
          })
        }
        className="h-9 bg-navy-900 px-4 text-xs font-bold uppercase text-white hover:bg-navy-800 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Confirm score"}
      </button>
      {result?.error && <span className="text-xs text-red-600">{result.error}</span>}
    </span>
  );
}

/**
 * "Can't make it this week." Two taps, and the confirm step says exactly what
 * happens: the team's one makeup of the season, or — once that's used — a
 * forfeit to the other team.
 */
export function SkipButton({
  matchId,
  consequence,
  warning,
  opponentName,
}: {
  matchId: string;
  consequence: "makeup" | "forfeit";
  /** Why it's a forfeit (shown in the confirm step). */
  warning?: string;
  opponentName: string;
}) {
  const [armed, setArmed] = useState(false);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();
  const forfeit = consequence === "forfeit";

  if (result?.ok) return <p className="text-xs text-navy-800">{result.message}</p>;
  if (!armed) {
    return (
      <button type="button" onClick={() => setArmed(true)} className="text-xs font-bold uppercase text-ink/55 underline underline-offset-2">
        Can&apos;t make it this week
      </button>
    );
  }
  return (
    <div className={forfeit ? "mt-2 border-2 border-red-300 bg-red-50 p-3" : "mt-2 border-2 border-gold-500 bg-gold-500/10 p-3"}>
      {forfeit ? (
        <p className="text-sm text-navy-900">
          <strong>{warning}</strong> {opponentName} gets the win, and everyone in the match is emailed. This can&apos;t be undone
          from here.
        </p>
      ) : (
        <p className="text-sm text-navy-900">
          This uses your team&apos;s <strong>one skip for the season</strong>. The match becomes a makeup due next Saturday and your
          opponents are emailed. If the makeup doesn&apos;t happen, your team forfeits it — and any skip after this is a forfeit.
        </p>
      )}
      <div className="mt-2 flex gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await safeSkipMatch(matchId, consequence);
              setResult(res);
              if (res.ok) router.refresh();
            })
          }
          className={
            forfeit
              ? "h-9 bg-red-600 px-4 text-xs font-bold uppercase text-white hover:bg-red-700 disabled:opacity-50"
              : "h-9 bg-navy-900 px-4 text-xs font-bold uppercase text-white hover:bg-navy-800 disabled:opacity-50"
          }
        >
          {pending ? "Saving…" : forfeit ? "Forfeit this match" : "Use our skip"}
        </button>
        <button type="button" onClick={() => setArmed(false)} className="text-xs font-bold uppercase text-ink/50">
          Cancel
        </button>
      </div>
      {result?.error && <p className="mt-2 text-xs text-red-600">{result.error}</p>}
    </div>
  );
}

/** Post (or change) when the match will be played. Due Wednesday 11:59 PM. */
export function PostTimeForm({ matchId, current, currentNote }: { matchId: string; current: string | null; currentNote: string | null }) {
  const [state, action] = useActionState(safeAction(postMatchTime), initialState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          current
            ? "text-xs font-bold uppercase text-ink/55 underline underline-offset-2"
            : "h-9 bg-gold-500 px-4 text-xs font-bold uppercase text-navy-900 hover:bg-gold-400"
        }
      >
        {current ? "Change time" : "Post match time"}
      </button>
    );
  }
  return (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2 border-2 border-navy-900/10 bg-white p-3">
      <input type="hidden" name="matchId" value={matchId} />
      <label className="text-[11px] font-bold uppercase text-ink/50">
        When (Pacific)
        <input type="datetime-local" name="when" required defaultValue={current ?? ""} className="mt-1 block h-9 border-2 border-navy-900/15 bg-chalk px-2 text-sm" />
      </label>
      <label className="text-[11px] font-bold uppercase text-ink/50">
        Where / note
        <input name="note" maxLength={80} defaultValue={currentNote ?? ""} placeholder="Court 3" className="mt-1 block h-9 w-36 border-2 border-navy-900/15 bg-chalk px-2 text-sm" />
      </label>
      <SubmitButton label="Post" />
      <button type="button" onClick={() => setOpen(false)} className="h-9 px-2 text-xs font-bold uppercase text-ink/50">
        Cancel
      </button>
      {state.error && <p className="w-full text-xs text-red-600">{state.error}</p>}
      {state.ok && state.message && <p className="w-full text-xs text-navy-800">{state.message}</p>}
    </form>
  );
}
