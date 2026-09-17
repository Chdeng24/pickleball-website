"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { moveTeam, withdraw, generateDraft, publish, resolveDispute, type ActionResult } from "../actions";

const initialState: ActionResult = { ok: true };

export function MoveTeamPoolSelect({ teamId, currentPool }: { teamId: string; currentPool: string | null }) {
  const [state, action] = useActionState(moveTeam, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form action={action} ref={formRef} className="inline-flex items-center gap-2">
      <input type="hidden" name="teamId" value={teamId} />
      <select
        name="pool"
        defaultValue={currentPool ?? ""}
        onChange={() => formRef.current?.requestSubmit()}
        className="h-8 border-2 border-navy-900/15 bg-white px-2 text-xs font-bold uppercase text-navy-900"
      >
        {!currentPool && <option value="">—</option>}
        {Array.from({ length: 10 }, (_, i) => String.fromCharCode(65 + i)).map((p) => (
          <option key={p} value={p}>
            Pool {p}
          </option>
        ))}
      </select>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

export function WithdrawTeamButton({ teamId }: { teamId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-xs text-ink/60">Withdraw this team?</span>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await withdraw(teamId);
              if (!res.ok) setError(res.error ?? "Failed.");
              else router.refresh();
            })
          }
          className="h-7 bg-red-600 px-2.5 text-xs font-bold uppercase text-white hover:bg-red-700"
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-xs font-bold uppercase text-ink/50"
        >
          Cancel
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="h-7 border-2 border-red-300 px-2.5 text-xs font-bold uppercase text-red-600 hover:border-red-600"
    >
      Withdraw
    </button>
  );
}

export function GenerateDraftButton({ tournamentId }: { tournamentId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await generateDraft(tournamentId);
            if (!res.ok) setError(res.error ?? "Failed.");
            else router.refresh();
          })
        }
        className="h-11 bg-navy-900 px-6 font-display text-xs font-bold uppercase tracking-[0.12em] text-white transition-colors hover:bg-navy-800 disabled:opacity-50"
      >
        {pending ? "Generating…" : "Generate / regenerate draft draw"}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

export function PublishDrawButton({ tournamentId }: { tournamentId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (confirming) {
    return (
      <div className="border-2 border-gold-500 bg-gold-500/10 p-4">
        <p className="text-sm text-navy-900">
          This locks the pools and emails every team their opponents. You won&apos;t be able to
          move teams between pools after this — you sure?
        </p>
        <div className="mt-3 flex gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await publish(tournamentId);
                if (!res.ok) setError(res.error ?? "Failed.");
                else router.refresh();
              })
            }
            className="h-10 bg-navy-900 px-5 font-display text-xs font-bold uppercase tracking-[0.12em] text-white hover:bg-navy-800"
          >
            Publish pools
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="h-10 px-5 text-xs font-bold uppercase text-ink/50"
          >
            Cancel
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="h-11 bg-gold-500 px-6 font-display text-xs font-bold uppercase tracking-[0.12em] text-navy-900 transition-colors hover:bg-gold-400"
    >
      Publish pools
    </button>
  );
}

export function ResolveDisputeForm({
  reportId,
  teamAId,
  teamAName,
  teamBId,
  teamBName,
}: {
  reportId: string;
  teamAId: string;
  teamAName: string;
  teamBId: string;
  teamBName: string;
}) {
  const [state, action] = useActionState(resolveDispute, initialState);

  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="reportId" value={reportId} />
      <span className="text-xs font-bold uppercase text-ink/50">Winner:</span>
      <button
        type="submit"
        name="winnerTeamId"
        value={teamAId}
        className="h-8 border-2 border-navy-900/15 px-3 text-xs font-bold uppercase text-navy-900 hover:border-navy-900"
      >
        {teamAName}
      </button>
      <button
        type="submit"
        name="winnerTeamId"
        value={teamBId}
        className="h-8 border-2 border-navy-900/15 px-3 text-xs font-bold uppercase text-navy-900 hover:border-navy-900"
      >
        {teamBName}
      </button>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
