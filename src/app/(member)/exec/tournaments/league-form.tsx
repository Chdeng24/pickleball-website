"use client";

import { useActionState, useRef } from "react";
import { useFormStatus } from "react-dom";
import { createLeague, updateLeague, type ActionResult } from "./actions";
import { venue } from "@/lib/content";

export type LeagueDefaults = {
  id: string;
  name: string;
  division: "beginner" | "advanced" | "competitive";
  eligibility: "all" | "competitive_only";
  location: string | null;
  maxPlayers: number | null;
  autoconfirmHours: number;
  seasonStartsOn: string | null;
  roundRobinWeeks: number;
  catchupWeeks: number;
  playoffTeams: number;
  finalOn: string | null;
  /** Already converted to a Pacific datetime-local value ("YYYY-MM-DDTHH:mm"). */
  registrationClosesAtInput: string;
};

const initialState: ActionResult = { ok: false };

const input = "h-11 w-full border-2 border-navy-900/15 bg-white px-3 text-sm text-ink focus:border-navy-800";
const label = "text-xs font-semibold uppercase tracking-wide text-ink/50";

function SubmitButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 bg-navy-900 px-7 font-display text-xs font-bold uppercase tracking-[0.12em] text-white transition-colors hover:bg-navy-800 disabled:opacity-50"
    >
      {pending ? "Saving…" : editing ? "Save changes" : "Create league"}
    </button>
  );
}

export function LeagueForm({ defaults }: { defaults?: LeagueDefaults }) {
  const [state, action] = useActionState(defaults ? updateLeague : createLeague, initialState);
  const eligibilityRef = useRef<HTMLSelectElement>(null);

  return (
    <form action={action} className="grid gap-5 pt-5 sm:grid-cols-2">
      {defaults && <input type="hidden" name="id" value={defaults.id} />}

      <div className="sm:col-span-2">
        <label className={label}>Name</label>
        <input name="name" defaultValue={defaults?.name ?? "Pickleball League"} className={input} />
      </div>

      <div>
        <label className={label}>Division</label>
        <select
          name="division"
          defaultValue={defaults?.division ?? "beginner"}
          onChange={(e) => {
            // Competitive almost always means comp-only signup — pre-select it, exec can still change it.
            if (e.target.value === "competitive" && eligibilityRef.current) {
              eligibilityRef.current.value = "competitive_only";
            }
          }}
          className={input}
        >
          <option value="beginner">Beginner</option>
          <option value="advanced">Advanced</option>
          <option value="competitive">Competitive</option>
        </select>
      </div>

      <div>
        <label className={label}>Who can sign up</label>
        <select name="eligibility" ref={eligibilityRef} defaultValue={defaults?.eligibility ?? "all"} className={input}>
          <option value="all">Any approved member</option>
          <option value="competitive_only">Competitive Team only</option>
        </select>
      </div>

      <div>
        <label className={label}>Location</label>
        <input name="location" defaultValue={defaults ? (defaults.location ?? "") : venue.name} className={input} />
      </div>

      <div>
        <label className={label}>Max players (blank = no cap)</label>
        <input
          type="number"
          name="maxPlayers"
          min={2}
          max={512}
          defaultValue={defaults ? (defaults.maxPlayers ?? "") : ""}
          className={input}
        />
      </div>

      <div className="sm:col-span-2">
        <label className={label}>Registration closes (Pacific time — blank = open until you draw)</label>
        <input
          type="datetime-local"
          name="registrationClosesAt"
          defaultValue={defaults?.registrationClosesAtInput ?? ""}
          className={input}
        />
      </div>

      <div className="sm:col-span-2 border-t-2 border-navy-900/10 pt-5">
        <p className="font-display text-xs font-bold uppercase tracking-wide text-navy-900">Season</p>
        <p className="mt-1 text-xs text-ink/50">
          One match a week (Mon–Sun) for the round-robin weeks, then catch-up weeks with no new matches (makeups only),
          then single elimination one round a week, ending in the final.
        </p>
      </div>

      <div>
        <label className={label}>Week 1 starts (a Monday)</label>
        <input type="date" name="seasonStartsOn" defaultValue={defaults?.seasonStartsOn ?? ""} className={input} />
      </div>

      <div>
        <label className={label}>Final (date)</label>
        <input type="date" name="finalOn" defaultValue={defaults?.finalOn ?? ""} className={input} />
      </div>

      <div>
        <label className={label}>Round-robin weeks (matches per team)</label>
        <input type="number" name="roundRobinWeeks" min={1} max={15} defaultValue={defaults?.roundRobinWeeks ?? 7} className={input} />
      </div>

      <div>
        <label className={label}>Catch-up weeks before playoffs</label>
        <input type="number" name="catchupWeeks" min={0} max={3} defaultValue={defaults?.catchupWeeks ?? 1} className={input} />
      </div>

      <div>
        <label className={label}>Playoff teams</label>
        <select name="playoffTeams" defaultValue={defaults?.playoffTeams ?? 8} className={input}>
          {[2, 4, 8, 16].map((n) => (
            <option key={n} value={n}>
              Top {n}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={label}>Score dispute window (hours)</label>
        <input
          type="number"
          name="autoconfirmHours"
          min={1}
          max={168}
          defaultValue={defaults?.autoconfirmHours ?? 24}
          className={input}
        />
      </div>

      {state.error && <p className="text-sm text-red-600 sm:col-span-2">{state.error}</p>}
      {state.ok && state.message && <p className="text-sm font-semibold text-navy-900 sm:col-span-2">{state.message}</p>}

      <div className="sm:col-span-2">
        <SubmitButton editing={Boolean(defaults)} />
      </div>
    </form>
  );
}
