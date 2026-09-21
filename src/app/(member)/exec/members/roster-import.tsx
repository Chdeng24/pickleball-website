"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { importRosterList, type ImportResult } from "./actions";

const initialState: ImportResult = { ok: false };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-10 bg-navy-900 px-5 font-display text-xs font-bold uppercase tracking-[0.12em] text-white transition-colors hover:bg-navy-800 disabled:opacity-50"
    >
      {pending ? "Saving…" : "Add to roster"}
    </button>
  );
}

export function RosterImport() {
  const [state, action] = useActionState(importRosterList, initialState);

  return (
    <form action={action} className="space-y-3 border-2 border-navy-900/10 bg-white p-5">
      <p className="text-sm text-ink/70">
        Paste member emails — one per line, a comma list, a spreadsheet column, or a straight copy
        of Google Contacts all work. Roster <strong>@berkeley.edu</strong> emails are approved
        automatically when they sign in; anything else still waits for approval.
      </p>
      <textarea
        name="emails"
        rows={6}
        placeholder={"oski@berkeley.edu\ngoldenbear@berkeley.edu"}
        className="w-full border-2 border-navy-900/15 bg-chalk p-3 font-mono text-sm text-navy-900 focus:border-navy-800"
      />
      <label className="flex items-center gap-2 text-sm font-semibold text-navy-900">
        <input type="checkbox" name="competitive" className="h-4 w-4" />
        These are Competitive Team players (lets them sign up for the Comp league)
      </label>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.ok && state.message && (
        <p className="border-l-4 border-gold-500 bg-gold-500/10 p-3 text-sm text-navy-900">{state.message}</p>
      )}
      <SubmitButton />
    </form>
  );
}
