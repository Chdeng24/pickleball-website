"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { reportScore, disputeScore, type ActionResult } from "./actions";

const initialState: ActionResult = { ok: false };

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
  const [state, formAction] = useActionState(reportScore, initialState);
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
  const [state, formAction] = useActionState(disputeScore, initialState);
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
