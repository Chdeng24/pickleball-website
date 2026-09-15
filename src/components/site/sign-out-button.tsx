"use client";

import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";

export function SignOutButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => void signOut({ callbackUrl: "/" })}
      className={cn("font-display text-xs font-bold uppercase tracking-[0.1em]", className)}
    >
      Sign out
    </button>
  );
}
