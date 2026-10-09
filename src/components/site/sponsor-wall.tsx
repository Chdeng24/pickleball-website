import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { sponsors, sponsorPitch } from "@/lib/content";
import { Reveal } from "@/components/ui/reveal";
import { Button } from "@/components/ui/button";

export function SponsorWall() {
  return (
    <>
      <div className="mt-14 grid gap-4 sm:grid-cols-2">
        {sponsors.map((s) => {
          const logo = (
            <Image
              src={s.logo}
              alt={s.name}
              width={s.width}
              height={s.height}
              sizes="(min-width: 640px) 30vw, 70vw"
              className="h-auto max-h-20 w-auto max-w-[75%] object-contain transition-transform duration-300 group-hover:scale-105"
            />
          );
          const tile = "group flex aspect-[5/2] items-center justify-center bg-white p-8";
          return s.url ? (
            <a key={s.name} href={s.url} target="_blank" rel="noopener noreferrer" className={tile} aria-label={s.name}>
              {logo}
            </a>
          ) : (
            <div key={s.name} className={tile}>
              {logo}
            </div>
          );
        })}
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
