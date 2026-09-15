"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { saveEvent, type FormState } from "./actions";
import { utcToLaInputValue } from "@/lib/dates";
import { cn } from "@/lib/utils";

export type EventDefaults = {
  id: string;
  type: "practice" | "social" | "fundraiser" | "tournament";
  title: string;
  description: string | null;
  level: "unknown" | "beginner" | "advanced";
  location: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number | null;
  rsvpOpensAt: Date | null;
  cancelDeadline: Date | null;
};

const initialState: FormState = { ok: false };

function field(name: string, errors?: Record<string, string>) {
  return errors?.[name];
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 bg-navy-900 px-7 font-display text-xs font-bold uppercase tracking-[0.12em] text-white transition-colors hover:bg-navy-800 disabled:opacity-50"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

/** Handles both create (no `defaults`) and edit (`defaults` supplied). */
export function EventForm({ defaults }: { defaults?: EventDefaults }) {
  const [state, action] = useActionState(saveEvent, initialState);
  const [type, setType] = useState(defaults?.type ?? "practice");
  const [unlimited, setUnlimited] = useState(defaults ? defaults.capacity === null : false);

  const err = (name: string) => field(name, state.fieldErrors);
  const inputClass = (name: string) =>
    cn(
      "h-11 w-full border-2 bg-white px-3 text-sm text-ink",
      err(name) ? "border-red-400" : "border-navy-900/15 focus:border-navy-800",
    );

  return (
    <form action={action} className="grid gap-5 sm:grid-cols-2">
      {defaults && <input type="hidden" name="id" value={defaults.id} />}

      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">Type</label>
        <select
          name="type"
          defaultValue={defaults?.type ?? "practice"}
          onChange={(e) => setType(e.target.value as typeof type)}
          className={inputClass("type")}
        >
          <option value="practice">Practice</option>
          <option value="social">Social</option>
          <option value="fundraiser">Fundraiser</option>
          <option value="tournament">Tournament</option>
        </select>
      </div>

      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">Level</label>
        <select name="level" defaultValue={defaults?.level ?? "unknown"} className={inputClass("level")}>
          <option value="unknown">—</option>
          <option value="beginner">Beginner</option>
          <option value="advanced">Advanced</option>
        </select>
      </div>

      <div className="sm:col-span-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">Title</label>
        <input name="title" defaultValue={defaults?.title} className={inputClass("title")} />
        {err("title") && <p className="mt-1 text-xs text-red-600">{err("title")}</p>}
      </div>

      <div className="sm:col-span-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">
          Description
        </label>
        <textarea
          name="description"
          defaultValue={defaults?.description ?? ""}
          rows={3}
          className={cn(inputClass("description"), "h-auto py-2")}
        />
      </div>

      <div className="sm:col-span-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">
          Location
        </label>
        <input name="location" defaultValue={defaults?.location} className={inputClass("location")} />
        {err("location") && <p className="mt-1 text-xs text-red-600">{err("location")}</p>}
      </div>

      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">
          Starts (Pacific time)
        </label>
        <input
          type="datetime-local"
          name="startsAt"
          defaultValue={defaults ? utcToLaInputValue(defaults.startsAt) : undefined}
          className={inputClass("startsAt")}
        />
        {err("startsAt") && <p className="mt-1 text-xs text-red-600">{err("startsAt")}</p>}
      </div>

      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">
          Ends (Pacific time)
        </label>
        <input
          type="datetime-local"
          name="endsAt"
          defaultValue={defaults ? utcToLaInputValue(defaults.endsAt) : undefined}
          className={inputClass("endsAt")}
        />
        {err("endsAt") && <p className="mt-1 text-xs text-red-600">{err("endsAt")}</p>}
      </div>

      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">
          RSVP opens (optional, Pacific time)
        </label>
        <input
          type="datetime-local"
          name="rsvpOpensAt"
          defaultValue={defaults?.rsvpOpensAt ? utcToLaInputValue(defaults.rsvpOpensAt) : undefined}
          className={inputClass("rsvpOpensAt")}
        />
      </div>

      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">
          Cancel deadline (optional, Pacific time)
        </label>
        <input
          type="datetime-local"
          name="cancelDeadline"
          defaultValue={
            defaults?.cancelDeadline ? utcToLaInputValue(defaults.cancelDeadline) : undefined
          }
          className={inputClass("cancelDeadline")}
        />
      </div>

      <div className="sm:col-span-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-ink/50">Capacity</label>
        <div className="mt-1 flex items-center gap-4">
          <input
            type="number"
            name="capacity"
            min={1}
            disabled={unlimited}
            defaultValue={defaults?.capacity ?? (!defaults && type === "practice" ? 20 : undefined)}
            className={cn(inputClass("capacity"), "w-32 disabled:opacity-40")}
          />
          <label className="flex items-center gap-2 text-sm text-ink/60">
            <input
              type="checkbox"
              checked={unlimited}
              onChange={(e) => setUnlimited(e.target.checked)}
            />
            Unlimited (socials, fundraisers)
          </label>
        </div>
        {err("capacity") && <p className="mt-1 text-xs text-red-600">{err("capacity")}</p>}
      </div>

      {state.error && (
        <p className="sm:col-span-2 border-2 border-red-400/40 bg-red-50 p-3 text-sm text-red-700">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="sm:col-span-2 border-2 border-green-500/30 bg-green-50 p-3 text-sm text-green-700">
          Saved.
        </p>
      )}

      <div className="sm:col-span-2">
        <SubmitButton label={defaults ? "Save changes" : "Create event"} />
      </div>
    </form>
  );
}
