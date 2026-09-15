import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { Section } from "@/components/site/section";
import { PracticeSchedule } from "@/components/site/practice-schedule";
import { JoinCta } from "@/components/site/join-cta";
import { teams } from "@/lib/content";

export function generateStaticParams() {
  return teams.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/teams/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const team = teams.find((t) => t.slug === slug);
  return { title: team?.name ?? "Team" };
}

export default async function TeamPage({ params }: PageProps<"/teams/[slug]">) {
  const { slug } = await params;
  const team = teams.find((t) => t.slug === slug);
  if (!team) notFound();

  return (
    <>
      <Section
        tone="navy"
        className="pt-36 sm:pt-44"
        kicker={team.kicker}
        title={team.name}
        lead={team.description}
      >
        <ul className="mt-12 grid gap-4 sm:grid-cols-2">
          {team.highlights.map((h) => (
            <li key={h} className="flex gap-3 border-l-2 border-gold-500 pl-4 text-white/80">
              <Check size={18} className="mt-0.5 shrink-0 text-gold-500" />
              {h}
            </li>
          ))}
        </ul>
      </Section>

      {team.slug === "social" && (
        <Section
          kicker="Every week"
          title="Practice schedule"
          lead="Two practices, split by level, capped by court space."
        >
          <PracticeSchedule />
        </Section>
      )}

      <JoinCta />
    </>
  );
}
