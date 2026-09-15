import { ArrowRight } from "lucide-react";
import { sponsors, sponsorPitch } from "@/lib/content";
import { Reveal } from "@/components/ui/reveal";
import { Button } from "@/components/ui/button";

export function SponsorWall() {
  return (
    <>
      <div className="mt-14 grid grid-cols-2 gap-px bg-white/10 lg:grid-cols-4">
        {sponsors.map((s, i) => (
          <div
            key={`${s.name}-${i}`}
            className="flex aspect-[3/2] items-center justify-center bg-navy-900 p-6 text-center"
          >
            {/* TODO: swap for <Image> once sponsor logos land */}
            <span className="font-display text-xs font-bold uppercase tracking-[0.14em] text-white/30">
              {s.name}
            </span>
          </div>
        ))}
      </div>

      <Reveal>
        <div className="mt-16 border-2 border-gold-500 p-8 sm:p-12">
          <h3 className="max-w-2xl font-display text-2xl font-extrabold uppercase leading-tight text-white sm:text-3xl">
            {sponsorPitch.headline}
          </h3>

          <dl className="mt-10 grid gap-8 sm:grid-cols-3">
            {sponsorPitch.points.map((p) => (
              <div key={p.label}>
                <dd className="font-display text-4xl font-extrabold text-gold-500">
                  {p.stat}
                </dd>
                <dt className="mt-2 text-sm text-white/60">{p.label}</dt>
              </div>
            ))}
          </dl>

          <Button href="/sponsors" variant="gold" size="md" className="mt-10">
            Partner with us <ArrowRight size={17} />
          </Button>
        </div>
      </Reveal>
    </>
  );
}
