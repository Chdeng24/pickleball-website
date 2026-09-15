import type { Metadata } from "next";
import { Section } from "@/components/site/section";
import { JoinCta } from "@/components/site/join-cta";
import { Reveal } from "@/components/ui/reveal";
import { club, officers } from "@/lib/content";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <>
      <Section
        tone="navy"
        className="pt-36 sm:pt-44"
        kicker="About"
        title="Who we are"
        lead={club.blurb}
      />

      <Section kicker="The board" title="Officers">
        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {officers.map((o, i) => (
            <Reveal key={`${o.role}-${i}`} delay={i * 0.08}>
              <div className="border-2 border-navy-900/10">
                {/* TODO: officer headshots */}
                <div className="aspect-square bg-navy-800/5" />
                <div className="p-5">
                  <h3 className="font-display text-lg font-extrabold uppercase text-navy-900">
                    {o.name}
                  </h3>
                  <p className="kicker mt-2 text-ink/45">{o.role}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      <JoinCta />
    </>
  );
}
