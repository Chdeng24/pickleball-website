"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, CalendarDays, Trophy, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { href: "/exec/events", label: "Events", icon: CalendarDays },
  { href: "/exec/members", label: "Members", icon: Users },
  { href: "/exec/tournaments", label: "Tournaments", icon: Trophy },
] as const;

/** Persistent sub-nav across every /exec/* page — so jumping between sections (or back to Exec home) never depends on browser back. */
export function ExecNav() {
  const pathname = usePathname();

  return (
    <div className="mb-8 flex flex-wrap items-center gap-2 border-b-2 border-navy-900/10 pb-4">
      <Link
        href="/exec"
        className="flex items-center gap-1.5 pr-3 text-sm font-semibold text-navy-800 underline underline-offset-2"
      >
        <ArrowLeft size={14} /> Exec
      </Link>
      {links.map((l) => {
        const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              "flex items-center gap-1.5 border-2 px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wide transition-colors",
              active
                ? "border-navy-900 bg-navy-900 text-white"
                : "border-navy-900/15 text-navy-900 hover:border-navy-900",
            )}
          >
            <l.icon size={13} /> {l.label}
          </Link>
        );
      })}
    </div>
  );
}
