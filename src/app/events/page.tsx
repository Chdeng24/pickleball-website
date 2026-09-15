import type { Metadata } from "next";
import { CalendarDays, Lock } from "lucide-react";
import { Section } from "@/components/site/section";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Events" };

export default function EventsPage() {
  return (
    <Section
      tone="navy"
      className="min-h-[70svh] pt-36 sm:pt-44"
      kicker="Calendar"
      title="Upcoming events"
      lead="Practices, socials, fundraisers, and tournaments — all in one place."
    >
      {/* Phase 4-5: this becomes the live calendar + RSVP surface */}
      <div className="mt-14 border-2 border-white/15 p-10 text-center sm:p-16">
        <CalendarDays size={40} className="mx-auto text-gold-500" />
        <h3 className="mt-6 font-display text-2xl font-extrabold uppercase text-white">
          The calendar lands next
        </h3>
        <p className="mx-auto mt-4 max-w-md text-white/60">
          Member sign-in, capped RSVPs, waitlists, and Google Calendar sync are
          in build. Sign in once it&apos;s live to claim your spot.
        </p>
        <Button href="/login" variant="gold" size="md" className="mt-8">
          <Lock size={15} /> Member login
        </Button>
      </div>
    </Section>
  );
}
