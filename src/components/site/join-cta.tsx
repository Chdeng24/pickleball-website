import { ArrowRight } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";

export function JoinCta() {
  return (
    <section className="grain relative overflow-hidden bg-navy-800 py-24 sm:py-32">
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,var(--color-navy-600),transparent_60%)]"
      />
      <Container className="relative text-center">
        <h2 className="mx-auto max-w-4xl font-display text-display font-extrabold uppercase text-white">
          Your spot is <span className="text-gold-500">one RSVP</span> away
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-lg text-white/70">
          Sign in with your @berkeley.edu account to RSVP for practices, see the
          full event calendar, and sync everything to Google Calendar.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
          <Button href="/login" variant="gold" size="lg">
            Sign in with Berkeley <ArrowRight size={18} />
          </Button>
          <Button href="/about" variant="outline" size="lg">
            New here? Start with About
          </Button>
        </div>
      </Container>
    </section>
  );
}
