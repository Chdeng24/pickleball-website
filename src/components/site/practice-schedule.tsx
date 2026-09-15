import { Clock, Lock, MapPin, Users } from "lucide-react";
import { practices } from "@/lib/content";
import { Reveal } from "@/components/ui/reveal";
import { Button } from "@/components/ui/button";

export function PracticeSchedule() {
  return (
    <>
      <div className="mt-14 grid gap-6 md:grid-cols-2">
        {practices.map((p, i) => (
          <Reveal key={p.id} delay={i * 0.1}>
            <article className="flex h-full flex-col border-2 border-navy-900/10 bg-white p-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="kicker text-navy-800/60">{p.level}</p>
                  <h3 className="mt-3 font-display text-2xl font-extrabold uppercase text-navy-900">
                    {p.title}
                  </h3>
                </div>
                <span className="shrink-0 bg-navy-900 px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wider text-gold-500">
                  {p.capacity} spots
                </span>
              </div>

              <dl className="mt-7 space-y-3 text-sm text-ink/70">
                <div className="flex items-center gap-3">
                  <Clock size={17} className="shrink-0 text-gold-500" />
                  <dd>
                    {p.day} &middot; {p.time}
                  </dd>
                </div>
                <div className="flex items-center gap-3">
                  <MapPin size={17} className="shrink-0 text-gold-500" />
                  <dd>{p.location}</dd>
                </div>
                <div className="flex items-center gap-3">
                  <Users size={17} className="shrink-0 text-gold-500" />
                  <dd>First {p.capacity} to RSVP — court capacity</dd>
                </div>
              </dl>

              <p className="mt-6 flex-1 text-sm leading-relaxed text-ink/60">{p.note}</p>

              <div className="mt-8 border-t border-navy-900/10 pt-6">
                <Button href="/login" variant="outlineDark" size="sm" className="w-full">
                  <Lock size={15} /> Sign in to RSVP
                </Button>
              </div>
            </article>
          </Reveal>
        ))}
      </div>

      <p className="mt-8 text-sm text-ink/50">
        RSVPs are limited by court capacity and open to verified Berkeley students.
        Full? Join the waitlist — you&apos;re promoted automatically when someone drops.
      </p>
    </>
  );
}
