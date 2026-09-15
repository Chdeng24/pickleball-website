"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { GoogleIcon } from "@/components/ui/icons";

/**
 * Client component: NextAuth's client-side signIn() manages the OAuth redirect
 * and popup/browser quirks better than driving it from a server action here.
 */
export function SignInButton() {
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void signIn("google", { callbackUrl: "/dashboard" });
      }}
      className="mt-9 flex h-12 w-full items-center justify-center gap-3 bg-white/90 font-display text-sm font-bold uppercase tracking-[0.1em] text-navy-900 transition-colors hover:bg-white disabled:opacity-60"
    >
      <GoogleIcon size={18} />
      {pending ? "Redirecting…" : "Continue with Google"}
    </button>
  );
}
