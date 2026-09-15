import type { Metadata } from "next";
import Image from "next/image";
import { ShieldCheck } from "lucide-react";
import { Container } from "@/components/ui/container";

export const metadata: Metadata = { title: "Member Login" };

export default function LoginPage() {
  return (
    <div className="grain relative flex min-h-[100svh] items-center bg-navy-900 py-32">
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,var(--color-navy-700),var(--color-navy-950))]"
      />
      <Container className="relative">
        <div className="mx-auto max-w-md border-2 border-white/15 bg-navy-950/60 p-9 backdrop-blur-sm sm:p-11">
          <Image
            src="/brand/logo.png"
            alt=""
            width={72}
            height={72}
            className="mx-auto h-18 w-18 rounded-full"
          />
          <h1 className="mt-7 text-center font-display text-3xl font-extrabold uppercase text-white">
            Member login
          </h1>
          <p className="mt-4 text-center text-sm leading-relaxed text-white/60">
            Members sign in with their UC Berkeley Google account. Access is
            limited to students on the club roster.
          </p>

          {/* Phase 3: replaced by the real Auth.js Google button */}
          <button
            disabled
            className="mt-9 flex h-12 w-full items-center justify-center gap-3 bg-white/90 font-display text-sm font-bold uppercase tracking-[0.1em] text-navy-900 disabled:opacity-45"
          >
            Continue with Google
          </button>
          <p className="mt-4 text-center text-xs text-white/35">
            Sign-in goes live with the member area.
          </p>

          <p className="mt-8 flex items-start gap-2.5 border-t border-white/10 pt-6 text-xs leading-relaxed text-white/40">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-gold-500" />
            Only @berkeley.edu accounts on the approved roster can access member
            pages and RSVP.
          </p>
        </div>
      </Container>
    </div>
  );
}
