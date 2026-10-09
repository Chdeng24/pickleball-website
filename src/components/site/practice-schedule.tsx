import { Suspense } from "react";
import { connection } from "next/server";
import { ArrowRight, Clock, MapPin, Users } from "lucide-react";
import { practices, type Practice } from "@/lib/content";
import { upcomingSaturday } from "@/lib/dates";
import { openPlaySpots, type OpenPlaySpots } from "@/lib/open-play";
import { Reveal } from "@/components/ui/reveal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Saturday open play, beginner and advanced — always the upcoming Saturday, with live spots from this week's posted session. */
export function PracticeSchedule() {
  return (
    <>
      <Suspense fallback={<Cards when={null} spots={null} />}>
        <LiveCards />
      </Suspense>

      <p className="mt-8 text-sm text-ink/50">
        RSVPs are limited by court capacity and open to verified Berkeley students.
        Full? Join the waitlist — you&apos;re promoted automatically when someone drops.
      </p>
    </>
  );
}

async function LiveCards() {
  await connection(); // the date and the spot counts are per request, never baked in at build
  const now = new Date();
  return <Cards when={upcomingSaturday(now)} spots={await openPlaySpots(now)} />;
}

function Cards({ when, spots }: { when: string | null; spots: Record<Practice["level"], OpenPlaySpots | null> | null }) {
  return (
    <div className="mt-14 grid gap-6 md:grid-cols-2">
      {practices.map((p, i) => (
        <Reveal key={p.id} delay={i * 0.1}>
          <PracticeCard practice={p} when={when} spots={spots ? spots[p.level] : undefined} />
        </Reveal>
      ))}
    </div>
  );
}

/** `spots` undefined = still loading; null = nothing posted yet this week. */
function PracticeCard({ practice: p, when, spots }: { practice: Practice; when: string | null; spots: OpenPlaySpots | null | undefined }) {
  const capacity = spots?.capacity ?? p.capacity;
  const full = spots ? spots.left === 0 : false;

  return (
    <article className="flex h-full flex-col border-2 border-navy-900/10 bg-white p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="kicker text-navy-800/60">{p.label}</p>
          <h3 className="mt-3 font-display text-2xl font-extrabold uppercase text-navy-900">{p.title}</h3>
        </div>
        <span
          className={cn(
            "shrink-0 px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wider",
            full ? "bg-red-700 text-white" : "bg-navy-900 text-gold-500",
          )}
        >
          {!spots ? `${capacity} spots` : full ? "Full" : `${spots.left} ${spots.left === 1 ? "spot" : "spots"} left`}
        </span>
      </div>

      {spots && (
        <div className="mt-5" aria-hidden>
          <div className="h-1.5 w-full bg-navy-900/10">
            <div className="h-full bg-gold-500 transition-[width] duration-700" style={{ width: `${Math.min(100, (spots.taken / capacity) * 100)}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-ink/45">
            {spots.taken} of {capacity} taken{full ? " — waitlist open" : ""}
          </p>
        </div>
      )}

      <dl className="mt-6 space-y-3 text-sm text-ink/70">
        <div className="flex items-center gap-3">
          <Clock size={17} className="shrink-0 text-gold-500" />
          <dd>
            {when ?? "Saturday"} &middot; {p.time}
          </dd>
        </div>
        <div className="flex items-center gap-3">
          <MapPin size={17} className="shrink-0 text-gold-500" />
          <dd>{p.location}</dd>
        </div>
        <div className="flex items-center gap-3">
          <Users size={17} className="shrink-0 text-gold-500" />
          <dd>First {capacity} to RSVP — court capacity</dd>
        </div>
      </dl>

      <p className="mt-6 flex-1 text-sm leading-relaxed text-ink/60">{p.note}</p>

      <div className="mt-8 border-t border-navy-900/10 pt-6">
        <Button href={spots ? `/events/${spots.eventId}` : "/login"} variant="outlineDark" size="sm" className="w-full">
          {spots ? (full ? "Join the waitlist" : "RSVP") : "Sign in to RSVP"} <ArrowRight size={15} />
        </Button>
      </div>
    </article>
  );
}
