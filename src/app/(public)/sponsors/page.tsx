import type { Metadata } from "next";
import { Section } from "@/components/site/section";
import { SponsorWall } from "@/components/site/sponsor-wall";
import { club } from "@/lib/content";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Sponsors" };

export default function SponsorsPage() {
  return (
    <>
      <Section
        tone="navy"
        className="pt-36 sm:pt-44"
        kicker="Partners"
        title="Partner with us"
        lead="Reach 200+ UC Berkeley students who show up twice a week, every week."
      >
        <SponsorWall />

        <div className="mt-16 border-t border-white/10 pt-12">
          <h3 className="font-display text-xl font-extrabold uppercase text-white">
            Get the media kit
          </h3>
          <p className="mt-4 max-w-lg text-white/60">
            {/* TODO: attach the real media kit PDF */}
            Email us for our sponsorship deck, tier pricing, and audience numbers.
          </p>
          <Button href={`mailto:${club.email}`} variant="gold" size="md" className="mt-7">
            Contact the club
          </Button>
        </div>
      </Section>
    </>
  );
}
