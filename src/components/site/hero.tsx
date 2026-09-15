import { ArrowRight, CalendarDays } from "lucide-react";
import { club } from "@/lib/content";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { HeroMedia } from "./hero-media";

export function Hero() {
  return (
    <section className="grain relative flex min-h-[92svh] items-end overflow-hidden">
      <HeroMedia />

      <Container className="relative z-10 pb-20 pt-32 sm:pb-28">
        <p className="kicker flex items-center gap-3 text-gold-500">
          <span aria-hidden className="h-px w-10 bg-gold-500" />
          Est. {club.foundedYear} &nbsp;&middot;&nbsp; UC Berkeley
        </p>

        <h1 className="mt-7 max-w-5xl font-display text-mega font-extrabold uppercase text-white">
          Pickleball
          <br />
          <span className="text-gold-500">at Berkeley</span>
        </h1>

        <div className="mt-8 flex max-w-2xl flex-col gap-6">
          <div aria-hidden className="h-1 w-28 bg-gold-500" />
          <p className="text-lg leading-relaxed text-white/75 sm:text-xl">
            {club.tagline}. Two practices a week, a season of socials, and 200+
            students who&apos;d rather be on the court.
          </p>
        </div>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:gap-4">
          <Button href="/login" variant="gold" size="lg">
            Join the Club <ArrowRight size={18} />
          </Button>
          <Button href="/events" variant="outline" size="lg">
            <CalendarDays size={18} /> Upcoming Events
          </Button>
        </div>
      </Container>

      {/* Gold rule anchoring the hero to the section below */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-1.5 bg-gold-500" />
    </section>
  );
}
