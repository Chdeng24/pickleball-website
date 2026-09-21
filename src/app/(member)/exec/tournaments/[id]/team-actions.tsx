"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { cn } from "@/lib/utils";
import {
  discardDraft,
  endLeague,
  generateDraft,
  moveTeam,
  pairTeams,
  publish,
  resolveDispute,
  withdraw,
  type ActionResult,
} from "../actions";

const initialState: ActionResult = { ok: true };

const TONES = {
  primary: "bg-navy-900 text-white hover:bg-navy-800",
  gold: "bg-gold-500 text-navy-900 hover:bg-gold-400",
  danger: "bg-red-600 text-white hover:bg-red-700",
  outline: "border-2 border-navy-900/20 text-navy-900 hover:border-navy-900",
  dangerOutline: "border-2 border-red-300 text-red-600 hover:border-red-600",
};

/** One click to arm, a second to confirm — every exec action that changes what members see goes through this. */
function ConfirmButton({
  label,
  confirmText,
  confirmLabel = "Confirm",
  run,
  tone = "primary",
  small = false,
}: {
  label: string;
  confirmText?: string;
  confirmLabel?: string;
  run: () => Promise<ActionResult>;
  tone?: keyof typeof TONES;
  small?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();
  const size = small ? "h-7 px-2.5 text-xs" : "h-11 px-6 text-xs tracking-[0.12em]";

  const go = () =>
    startTransition(async () => {
      const res = await run();
      setResult(res);
      setArmed(false);
      if (res.ok) router.refresh();
    });

  if (armed && confirmText) {
    return (
      <div className={cn("border-2 p-4", tone.startsWith("danger") ? "border-red-300 bg-red-50" : "border-gold-500 bg-gold-500/10")}>
        <p className="text-sm text-navy-900">{confirmText}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={go}
            className={cn("h-10 px-5 font-display text-xs font-bold uppercase tracking-[0.12em] disabled:opacity-50", TONES[tone.startsWith("danger") ? "danger" : "primary"])}
          >
            {pending ? "Working…" : confirmLabel}
          </button>
          <button type="button" onClick={() => setArmed(false)} className="h-10 px-4 text-xs font-bold uppercase text-ink/50">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => (confirmText ? setArmed(true) : go())}
        className={cn("font-display font-bold uppercase transition-colors disabled:opacity-50", size, TONES[tone])}
      >
        {pending ? "Working…" : label}
      </button>
      {result?.error && <span className="text-xs text-red-600">{result.error}</span>}
      {result?.ok && result.message && <span className="text-xs text-navy-800">{result.message}</span>}
    </span>
  );
}

export function GenerateDraftButton({
  tournamentId,
  regenerate,
  closesText,
}: {
  tournamentId: string;
  regenerate: boolean;
  /** When registration is still open by date, say so — generating the draw closes it immediately. */
  closesText: string | null;
}) {
  return (
    <ConfirmButton
      label={regenerate ? "Regenerate draft draw" : "Generate draft draw"}
      confirmText={
        regenerate
          ? "Reshuffle every pool from scratch? Any moves you made by hand are lost."
          : `This closes registration now${closesText ? ` (it was open until ${closesText})` : ""} and builds a draft only exec can see. Nothing is emailed until you publish, and you can discard the draft to reopen registration.`
      }
      confirmLabel={regenerate ? "Reshuffle" : "Close registration & draw"}
      run={() => generateDraft(tournamentId)}
    />
  );
}

export function DiscardDraftButton({ tournamentId }: { tournamentId: string }) {
  return (
    <ConfirmButton
      label="Discard draft & reopen registration"
      tone="outline"
      confirmText="Throw away this draft and reopen registration? If the deadline has passed, extend it in Settings too."
      confirmLabel="Discard draft"
      run={() => discardDraft(tournamentId)}
    />
  );
}

export function PublishDrawButton({ tournamentId, leftOut }: { tournamentId: string; leftOut: number }) {
  return (
    <ConfirmButton
      label="Publish pools"
      tone="gold"
      confirmText={`This locks the pools, shows them to members, and emails every team their opponents. You can't move teams after this.${
        leftOut ? ` ${leftOut} incomplete team${leftOut === 1 ? " is" : "s are"} NOT in the draw and will sit out.` : ""
      }`}
      confirmLabel="Publish"
      run={() => publish(tournamentId)}
    />
  );
}

export function EndLeagueButton({ tournamentId }: { tournamentId: string }) {
  return (
    <ConfirmButton
      label="End league"
      tone="dangerOutline"
      confirmText="End this league? It disappears from members' Tournaments tab, and players are free to join next semester's league. Results stay here."
      confirmLabel="End league"
      run={() => endLeague(tournamentId)}
    />
  );
}

export function WithdrawTeamButton({ teamId, live }: { teamId: string; live: boolean }) {
  return (
    <ConfirmButton
      label="Withdraw"
      tone="dangerOutline"
      small
      confirmText={
        live
          ? "Withdraw this team? Their unplayed matches are removed (a bye for opponents); played results stay."
          : "Withdraw this team? Their spots open back up."
      }
      confirmLabel="Withdraw"
      run={() => withdraw(teamId)}
    />
  );
}

export function MoveTeamPoolSelect({
  teamId,
  currentPool,
  pools,
}: {
  teamId: string;
  currentPool: string | null;
  pools: string[];
}) {
  const [state, action] = useActionState(moveTeam, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  // Existing pools, plus the next letter so exec can split a pool if they need to.
  const next = String.fromCharCode(65 + pools.length);
  const options = [...pools, next];

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
        {options.map((p) => (
          <option key={p} value={p}>
            Pool {p}
            {p === next ? " (new)" : ""}
          </option>
        ))}
      </select>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

export function PairTeamForm({ teamId, options }: { teamId: string; options: { id: string; label: string }[] }) {
  const [state, action] = useActionState(pairTeams, initialState);
  if (options.length === 0) return <span className="text-xs text-ink/40">No one else to pair with yet</span>;

  return (
    <form action={action} className="inline-flex flex-wrap items-center gap-2">
      <input type="hidden" name="teamAId" value={teamId} />
      <select name="teamBId" defaultValue="" className="h-8 border-2 border-navy-900/15 bg-white px-2 text-xs text-navy-900">
        <option value="" disabled>
          Pair with…
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <button type="submit" className="h-8 bg-navy-900 px-3 text-xs font-bold uppercase text-white hover:bg-navy-800">
        Pair
      </button>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
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
