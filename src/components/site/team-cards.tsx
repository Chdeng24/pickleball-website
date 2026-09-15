import Link from "next/link";
import { ArrowUpRight, Check } from "lucide-react";
import { teams } from "@/lib/content";
import { Reveal } from "@/components/ui/reveal";

export function TeamCards() {
  return (
    <div className="mt-14 grid gap-6 lg:grid-cols-2">
      {teams.map((team, i) => (
        <Reveal key={team.slug} delay={i * 0.1}>
          <Link
            href={`/teams/${team.slug}`}
            className="group relative flex h-full flex-col overflow-hidden bg-navy-900 p-8 transition-colors hover:bg-navy-800 sm:p-10"
          >
            {/* Gold wedge that grows on hover */}
            <span
              aria-hidden
              className="absolute right-0 top-0 h-1.5 w-16 bg-gold-500 transition-all duration-500 group-hover:w-full"
            />
            <p className="kicker text-gold-500">{team.kicker}</p>
            <h3 className="mt-4 font-display text-3xl font-extrabold uppercase text-white sm:text-4xl">
              {team.name}
            </h3>
            <p className="mt-5 leading-relaxed text-white/65">{team.description}</p>

            <ul className="mt-7 space-y-3">
              {team.highlights.map((h) => (
                <li key={h} className="flex gap-3 text-sm text-white/80">
                  <Check size={17} className="mt-0.5 shrink-0 text-gold-500" />
                  {h}
                </li>
              ))}
            </ul>

            <span className="mt-9 inline-flex items-center gap-2 font-display text-xs font-bold uppercase tracking-[0.14em] text-gold-500">
              Learn more
              <ArrowUpRight
                size={16}
                className="transition-transform group-hover:translate-x-1 group-hover:-translate-y-1"
              />
            </span>
          </Link>
        </Reveal>
      ))}
    </div>
  );
}
