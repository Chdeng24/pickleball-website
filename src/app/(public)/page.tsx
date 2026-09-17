import Image from "next/image";
import { Hero } from "@/components/site/hero";
import { StatStrip } from "@/components/site/stat-strip";
import { Section } from "@/components/site/section";
import { TeamCards } from "@/components/site/team-cards";
import { PracticeSchedule } from "@/components/site/practice-schedule";
import { SponsorWall } from "@/components/site/sponsor-wall";
import { TournamentCards } from "@/components/site/tournament-cards";
import { JoinCta } from "@/components/site/join-cta";
import { Reveal } from "@/components/ui/reveal";
import { Button } from "@/components/ui/button";
import { club } from "@/lib/content";

export default function HomePage() {
  return (
    <>
      <Hero />
      <StatStrip />

      <Section kicker="Who we are" title={<>Built on the court,<br />not the sidelines</>}>
        <div className="mt-12 grid items-center gap-14 lg:grid-cols-2">
          <Reveal>
            <div className="space-y-6 text-lg leading-relaxed text-ink/70">
              <p>{club.blurb}</p>
              <p>
                We run two capped practices every week so nobody stands around
                waiting for a court, plus socials, fundraisers, and tournaments
                that fill out the semester.
              </p>
              <p>
                Everything runs through this site — verified Berkeley logins,
                first-come RSVPs, and events that land straight on your Google
                Calendar the moment you&apos;re confirmed.
              </p>
              <Button href="/about" variant="outlineDark" size="md" className="mt-2">
                More about the club
              </Button>
            </div>
          </Reveal>

          <Reveal delay={0.12}>
            {/* TODO: replace with a real team photo */}
            <div className="grain relative aspect-[4/5] overflow-hidden bg-navy-800">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,var(--color-navy-600),var(--color-navy-950))]" />
              <Image
                src="/brand/logo.png"
                alt=""
                width={340}
                height={340}
                className="absolute left-1/2 top-1/2 w-3/5 -translate-x-1/2 -translate-y-1/2 opacity-90"
              />
              <span className="absolute bottom-5 left-5 kicker text-white/35">
                Team photo — coming soon
              </span>
            </div>
          </Reveal>
        </div>
      </Section>

      <Section
        tone="chalk"
        kicker="The teams"
        title="Two ways to play"
        lead="Everyone starts on the Social Team. Competitive is there when you want to take it further."
      >
        <TeamCards />
      </Section>

      <Section
        kicker="Every week"
        title="Weekly practices"
        lead="Two practices, split by level, capped by court space."
      >
        <PracticeSchedule />
      </Section>

      <Section
        tone="chalk"
        kicker="Compete"
        title="Play for something"
        lead="A semester-long Pickleball League and one-day club tournaments — both free, both open to every member."
      >
        <TournamentCards />
      </Section>

      <Section
        tone="navy"
        kicker="Partners"
        title="Backed by brands who get it"
        lead="We're building a sponsor program for the 2025–26 season."
      >
        <SponsorWall />
      </Section>

      <JoinCta />
    </>
  );
}
