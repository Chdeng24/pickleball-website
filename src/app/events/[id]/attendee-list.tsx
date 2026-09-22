import { Users } from "lucide-react";
import { attendeeName } from "@/lib/display-name";
import { rsvpListCopy } from "@/lib/content";

export type Attendee = { id: string; position: number; name: string | null; email: string };

/**
 * The public roll call for an event — who has already RSVP'd, so someone
 * deciding whether to come can see their friends are going. Server-rendered,
 * and it never emits an email address: `attendeeName` abbreviates surnames for
 * signed-out visitors, since this page is reachable without an account.
 */
export function AttendeeList({
  confirmed,
  waitlist,
  visibility,
}: {
  confirmed: Attendee[];
  waitlist: Attendee[];
  visibility: "full" | "abbreviated";
}) {
  return (
    <section className="mt-12 border-t-2 border-navy-900/10 pt-8">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-[0.12em] text-navy-900">
          <Users size={16} className="text-gold-500" />
          {rsvpListCopy.confirmed}
          <span className="font-semibold text-ink/40">{confirmed.length}</span>
        </h2>
        {visibility === "abbreviated" && (
          <p className="text-xs text-ink/40">{rsvpListCopy.signedOutNote}</p>
        )}
      </div>

      {confirmed.length === 0 ? (
        <p className="mt-4 text-sm text-ink/45">{rsvpListCopy.empty}</p>
      ) : (
        <ol className="mt-4 grid gap-x-8 gap-y-0 sm:grid-cols-2">
          {confirmed.map((a) => (
            <li
              key={a.id}
              className="flex items-baseline gap-3 border-b border-navy-900/5 py-2.5 text-sm"
            >
              <span className="w-5 shrink-0 text-xs font-bold tabular-nums text-ink/30">
                {a.position}
              </span>
              <span className="font-semibold text-navy-900">{attendeeName(a, visibility)}</span>
            </li>
          ))}
        </ol>
      )}

      {waitlist.length > 0 && (
        <div className="mt-8">
          <h3 className="font-display text-sm font-bold uppercase tracking-[0.12em] text-ink/50">
            {rsvpListCopy.waitlist}
            <span className="ml-2 font-semibold text-ink/35">{waitlist.length}</span>
          </h3>
          <ol className="mt-3 grid gap-x-8 gap-y-0 sm:grid-cols-2">
            {waitlist.map((a) => (
              <li
                key={a.id}
                className="flex items-baseline gap-3 border-b border-navy-900/5 py-2.5 text-sm"
              >
                <span className="w-5 shrink-0 text-xs font-bold tabular-nums text-ink/30">
                  {a.position}
                </span>
                <span className="text-ink/65">{attendeeName(a, visibility)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
