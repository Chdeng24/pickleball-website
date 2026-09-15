import { Check } from "lucide-react";
import { tournamentPrograms } from "@/lib/content";
import { Reveal } from "@/components/ui/reveal";

export function TournamentCards() {
  return (
    <div className="mt-14 grid gap-6 lg:grid-cols-2">
      {tournamentPrograms.map((t, i) => (
        <Reveal key={t.id} delay={i * 0.1}>
          <article className="flex h-full flex-col border-2 border-navy-900/10 bg-white p-8 sm:p-10">
            <p className="kicker text-navy-800/60">{t.kicker}</p>
            <h3 className="mt-4 font-display text-3xl font-extrabold uppercase text-navy-900">
              {t.name}
            </h3>
            <p className="mt-5 leading-relaxed text-ink/65">{t.summary}</p>
            <ul className="mt-7 space-y-3">
              {t.points.map((p) => (
                <li key={p} className="flex gap-3 text-sm text-ink/75">
                  <Check size={17} className="mt-0.5 shrink-0 text-gold-500" />
                  {p}
                </li>
              ))}
            </ul>
          </article>
        </Reveal>
      ))}
    </div>
  );
}
