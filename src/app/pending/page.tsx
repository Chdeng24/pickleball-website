import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Mail } from "lucide-react";
import { Container } from "@/components/ui/container";
import { getSessionUser } from "@/lib/session";
import { isActiveMember } from "@/lib/access";
import { club } from "@/lib/content";
import { SignOutButton } from "@/components/site/sign-out-button";

export const metadata: Metadata = { title: "Approval Pending" };

export default async function PendingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (isActiveMember(user)) redirect("/dashboard");

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
          <h1 className="mt-7 text-center font-display text-2xl font-extrabold uppercase text-white">
            Almost there, {user.name?.split(" ")[0] ?? "there"}
          </h1>
          <p className="mt-4 text-center text-sm leading-relaxed text-white/65">
            Your Berkeley account is verified, but you&apos;re not on the club
            roster yet. Once an officer approves you, RSVPs and events unlock
            automatically — no need to sign in again.
          </p>

          <a
            href={`mailto:${club.email}?subject=Roster access — ${user.email}`}
            className="mt-8 flex h-12 items-center justify-center gap-2 border-2 border-gold-500 font-display text-sm font-bold uppercase tracking-[0.1em] text-gold-500 transition-colors hover:bg-gold-500 hover:text-navy-900"
          >
            <Mail size={16} /> Email {club.shortName}
          </a>

          <div className="mt-6 flex justify-center">
            <SignOutButton className="text-xs text-white/40 underline-offset-4 hover:text-white/70 hover:underline" />
          </div>
        </div>
      </Container>
    </div>
  );
}
