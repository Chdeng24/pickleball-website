import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Container } from "@/components/ui/container";
import { getSessionUser } from "@/lib/session";
import { isActiveMember } from "@/lib/access";
import { SignInButton } from "./sign-in-button";

export const metadata: Metadata = { title: "Member Login" };

/** Auth.js error codes mapped to copy a member will actually understand. */
const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied:
    "That account isn't eligible. Sign in with your @berkeley.edu address.",
  Configuration: "Sign-in is temporarily unavailable. Please try again shortly.",
  Verification: "That sign-in link has expired. Please try again.",
};

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const params = await searchParams;
  const errorCode = typeof params.error === "string" ? params.error : null;

  const user = await getSessionUser();
  if (user) {
    redirect(isActiveMember(user) ? "/dashboard" : "/pending");
  }

  const errorMessage = errorCode
    ? (ERROR_MESSAGES[errorCode] ?? "Something went wrong signing you in. Please try again.")
    : null;

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

          {errorMessage && (
            <p className="mt-6 border-2 border-red-400/40 bg-red-400/10 p-3 text-center text-sm text-red-200">
              {errorMessage}
            </p>
          )}

          <SignInButton />

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
