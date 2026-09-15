import type { Metadata } from "next";
import { Trophy, Users, ClipboardCheck, CalendarClock } from "lucide-react";
import { Section } from "@/components/site/section";
import { TournamentCards } from "@/components/site/tournament-cards";
import { JoinCta } from "@/components/site/join-cta";
import { Reveal } from "@/components/ui/reveal";

export const metadata: Metadata = { title: "Tournaments" };

// How the semester-long intramural bracket actually runs, for members.
const howItWorks = [
  {
    icon: Users,
    title: "Find a partner",
    body: "Register as a pair, free. No partner? Join the free-agent pool and we'll match you.",
  },
  {
    icon: Trophy,
    title: "Get drawn into a pool",
    body: "Once registration closes you're placed in a pool of 8 teams, in either the Beginner or Advanced division.",
  },
  {
    icon: CalendarClock,
    title: "Play your 7 matches",
    body: "One against every other team in your pool. Best of 3, self-officiated at Clark Kerr — played in any order, whenever you and your opponents are both free.",
  },
  {
    icon: ClipboardCheck,
    title: "Top 3 make playoffs",
    body: "Any one of the four players reports each score. Standings update live, and the top 3 from each pool move into a single-elimination bracket.",
  },
];

export default function TournamentsPage() {
  return (
    <>
      <Section
        tone="navy"
        className="pt-36 sm:pt-44"
        kicker="Compete"
        title="Tournaments"
        lead="Two ways to play for something. Both open to every member, both free."
      />

      <Section tone="chalk">
        <TournamentCards />
      </Section>

      <Section
        kicker="Intramurals"
        title="How the bracket works"
        lead="Pool play into playoffs — scheduled around your own classes, not ours."
      >
        <ol className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {howItWorks.map((step, i) => (
            <Reveal key={step.title} delay={i * 0.08}>
              <li className="flex h-full flex-col border-t-4 border-gold-500 bg-chalk p-7">
                <step.icon size={26} className="text-navy-800" />
                <span className="kicker mt-6 text-ink/40">Step {i + 1}</span>
                <h3 className="mt-2 font-display text-xl font-extrabold uppercase text-navy-900">
                  {step.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-ink/65">{step.body}</p>
              </li>
            </Reveal>
          ))}
        </ol>

        <p className="mt-10 text-sm text-ink/50">
          Brackets, pairings, and score reporting all run through the member area —
          sign in with your Berkeley account once registration opens.
        </p>
      </Section>

      <JoinCta />
    </>
  );
}
