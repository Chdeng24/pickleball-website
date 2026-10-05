"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { cn } from "@/lib/utils";
import {
  addTeam,
  discardDraft,
  endLeague,
  fillSlot,
  generateDraft,
  makePlayoffs,
  pairTeams,
  publish,
  randomPair,
  resendSchedules,
  resolveDispute,
  scrapPlayoffs,
  setResult,
  swap,
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
  teamCount,
}: {
  tournamentId: string;
  regenerate: boolean;
  /** When registration is still open by date, say so — generating the draw closes it immediately. */
  closesText: string | null;
  /** Complete teams right now — to show what the open-slot choice means. */
  teamCount: number;
}) {
  // At least one late team is expected, so room for one is the default.
  const [openSlots, setOpenSlots] = useState(1);
  const slots = teamCount + openSlots + ((teamCount + openSlots) % 2);
  const open = slots - teamCount;
  return (
    <div className="space-y-3">
      <label className="flex flex-wrap items-center gap-2 text-sm text-navy-900">
        Leave room for
        <select
          value={openSlots}
          onChange={(e) => setOpenSlots(Number(e.target.value))}
          className="h-8 border-2 border-navy-900/15 bg-white px-2 text-sm"
        >
          {[0, 1, 2].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        late team{openSlots === 1 ? "" : "s"}
      </label>
      <p className="text-xs text-ink/55">
        {teamCount} teams → {slots} schedule slots,{" "}
        {open === 0
          ? "no byes."
          : `${open} open slot${open === 1 ? "" : "s"}. Whoever plays an open slot that week has a bye — until a late team takes it over, which changes nobody else's matchups.`}
      </p>
      <ConfirmButton
        label={regenerate ? "Regenerate draft schedule" : "Generate draft schedule"}
        confirmText={
          regenerate
            ? "Redraw the whole schedule from scratch? Any swaps you made by hand are lost."
            : `This closes registration now${closesText ? ` (it was open until ${closesText})` : ""} and builds a draft only exec can see. Nothing is emailed until you publish, and you can discard the draft to reopen registration.`
        }
        confirmLabel={regenerate ? "Redraw" : "Close registration & draw"}
        run={() => generateDraft(tournamentId, openSlots)}
      />
    </div>
  );
}

export function ResendSchedulesButton({ tournamentId, players }: { tournamentId: string; players: number }) {
  return (
    <ConfirmButton
      label="Email everyone their updated schedule"
      tone="outline"
      confirmText={`Email all ${players} players their current schedule, marked UPDATED so it replaces the earlier email? Use this after you've changed matchups.`}
      confirmLabel="Send emails"
      run={() => resendSchedules(tournamentId)}
    />
  );
}

export function RandomPairButton({ tournamentId, count }: { tournamentId: string; count: number }) {
  return (
    <ConfirmButton
      label={`Randomly pair ${count} free agent${count === 1 ? "" : "s"}`}
      tone="gold"
      confirmText={`Pair every solo player (no invite out) at random?${count % 2 ? " With an odd number, one is left over for you to sort out." : ""} You can still re-pair by hand: withdraw a team and add it back with the emails you want.`}
      confirmLabel="Pair them"
      run={() => randomPair(tournamentId)}
    />
  );
}

export function AddTeamForm({ tournamentId }: { tournamentId: string }) {
  const [state, action] = useActionState(addTeam, initialState);
  const input = "h-9 border-2 border-navy-900/15 bg-white px-2 text-sm";
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <input name="emailA" type="email" required placeholder="player1@berkeley.edu" className={input} />
      <input name="emailB" type="email" required placeholder="player2@berkeley.edu" className={input} />
      <input name="teamName" placeholder="Team name (optional)" className={input} />
      <button type="submit" className="h-9 bg-navy-900 px-4 text-xs font-bold uppercase text-white hover:bg-navy-800">
        Add team
      </button>
      {state.error && <span className="w-full text-xs text-red-600">{state.error}</span>}
      {state.ok && state.message && <span className="w-full text-xs text-navy-800">{state.message}</span>}
    </form>
  );
}

/** Auto-submitting select — swap this team's whole schedule with another's (or with an open slot / an unscheduled team). */
export function SwapSelect({ teamId, options, label = "Swap with…" }: { teamId: string; options: { id: string; label: string }[]; label?: string }) {
  const [state, action] = useActionState(swap, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form action={action} ref={formRef} className="inline-flex items-center gap-2">
      <input type="hidden" name="teamId" value={teamId} />
      <select
        name="otherId"
        defaultValue=""
        onChange={() => formRef.current?.requestSubmit()}
        className="h-8 max-w-48 border-2 border-navy-900/15 bg-white px-2 text-xs text-navy-900"
      >
        <option value="" disabled>
          {label}
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

export function FillSlotForm({ placeholderId, options }: { placeholderId: string; options: { id: string; label: string }[] }) {
  const [state, action] = useActionState(fillSlot, initialState);
  if (options.length === 0) return <span className="text-xs text-ink/40">No unscheduled complete team — add one below first</span>;
  return (
    <form action={action} className="inline-flex flex-wrap items-center gap-2">
      <input type="hidden" name="placeholderId" value={placeholderId} />
      <select name="teamId" defaultValue="" className="h-8 border-2 border-navy-900/15 bg-white px-2 text-xs text-navy-900">
        <option value="" disabled>
          Give this slot to…
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <button type="submit" className="h-8 bg-gold-500 px-3 text-xs font-bold uppercase text-navy-900 hover:bg-gold-400">
        Fill slot
      </button>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
      {state.ok && state.message && <span className="text-xs text-navy-800">{state.message}</span>}
    </form>
  );
}

export function MakePlayoffsButton({ tournamentId, size, regenerate }: { tournamentId: string; size: number; regenerate: boolean }) {
  return (
    <ConfirmButton
      label={regenerate ? "Re-seed playoff bracket" : `Seed top ${size} into playoffs`}
      tone="gold"
      confirmText={`Seed the top ${size} from the current standings into the bracket (1v${size}, …)? It's visible to members right away. You can swap teams or re-seed until the first playoff result is in.`}
      confirmLabel="Make bracket"
      run={() => makePlayoffs(tournamentId)}
    />
  );
}

export function ScrapPlayoffsButton({ tournamentId }: { tournamentId: string }) {
  return (
    <ConfirmButton
      label="Discard bracket"
      tone="outline"
      confirmText="Delete the playoff bracket and go back to round robin? Only possible before any playoff result."
      confirmLabel="Discard"
      run={() => scrapPlayoffs(tournamentId)}
    />
  );
}

type OutcomeKind = "score" | "forfeitA" | "forfeitB" | "double_forfeit" | "reopen" | "extend";

/** Exec override on one match. Collapsed to a small link until opened. */
export function MatchOverride({
  matchId,
  teamAName,
  teamBName,
  knockout,
  pending,
}: {
  matchId: string;
  teamAName: string;
  teamBName: string;
  knockout: boolean;
  pending: boolean;
}) {
  const [state, action] = useActionState(setResult, initialState);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<OutcomeKind>("score");
  const [games, setGames] = useState([
    ["", ""],
    ["", ""],
    ["", ""],
  ]);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-[11px] font-bold uppercase text-navy-800 underline underline-offset-2">
        Edit result
      </button>
    );
  }

  const submit = (formData: FormData) => {
    const outcome =
      kind === "score"
        ? { kind, games: games.filter(([a, b]) => a !== "" && b !== "").map(([a, b]) => [Number(a), Number(b)]) }
        : kind === "forfeitA"
          ? { kind: "forfeit", winner: "B" }
          : kind === "forfeitB"
            ? { kind: "forfeit", winner: "A" }
            : { kind };
    formData.set("matchId", matchId);
    formData.set("outcome", JSON.stringify(outcome));
    return action(formData);
  };

  const num = "h-8 w-14 border-2 border-navy-900/15 bg-chalk px-2 text-sm";
  return (
    <form action={submit} className="space-y-2 border-2 border-navy-900/10 bg-chalk/50 p-3">
      <select value={kind} onChange={(e) => setKind(e.target.value as OutcomeKind)} className="h-8 w-full border-2 border-navy-900/15 bg-white px-2 text-xs">
        <option value="score">Enter the score</option>
        <option value="forfeitA">{teamAName} forfeits — {teamBName} wins</option>
        <option value="forfeitB">{teamBName} forfeits — {teamAName} wins</option>
        {!knockout && <option value="double_forfeit">Double forfeit — nobody wins</option>}
        <option value="reopen">Reopen — back to unplayed</option>
        {pending && <option value="extend">Give them one more week</option>}
      </select>
      {kind === "score" && (
        <div className="space-y-1">
          <p className="text-[11px] text-ink/50">
            {teamAName} – {teamBName}
          </p>
          {games.map((g, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="number" min={0} value={g[0]} className={num} onChange={(e) => setGames((p) => p.map((r, ri) => (ri === i ? [e.target.value, r[1]] : r)))} />
              <span className="text-ink/40">–</span>
              <input type="number" min={0} value={g[1]} className={num} onChange={(e) => setGames((p) => p.map((r, ri) => (ri === i ? [r[0], e.target.value] : r)))} />
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" className="h-8 bg-navy-900 px-3 text-xs font-bold uppercase text-white hover:bg-navy-800">
          Save
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs font-bold uppercase text-ink/50">
          Close
        </button>
        {state.error && <span className="text-xs text-red-600">{state.error}</span>}
        {state.ok && state.message && <span className="text-xs text-navy-800">{state.message}</span>}
      </div>
    </form>
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
      label="Publish schedule"
      tone="gold"
      confirmText={`This locks the schedule, shows it to members, and emails every player their week-by-week opponents. After this, the only schedule changes are filling open slots and withdrawals.${
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

export function WithdrawTeamButton({ teamId, scheduled }: { teamId: string; scheduled: boolean }) {
  return (
    <ConfirmButton
      label="Withdraw"
      tone="dangerOutline"
      small
      confirmText={
        scheduled
          ? "Withdraw this team? Their remaining matches become an open slot (a bye for opponents unless a late team takes it). Played results stand."
          : "Withdraw this team? Their spots open back up."
      }
      confirmLabel="Withdraw"
      run={() => withdraw(teamId)}
    />
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
