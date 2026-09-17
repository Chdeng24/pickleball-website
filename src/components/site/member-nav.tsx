"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { LayoutDashboard, CalendarDays, Trophy, UserCircle, ShieldCheck } from "lucide-react";
import { isExec } from "@/lib/access";
import type { SessionUser } from "@/lib/session";
import { Container } from "@/components/ui/container";
import { cn } from "@/lib/utils";
import { SignOutButton } from "./sign-out-button";

const links = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/events", label: "Events", icon: CalendarDays },
  { href: "/tournaments", label: "Tournaments", icon: Trophy },
  { href: "/profile", label: "Profile", icon: UserCircle },
] as const;

/** Active if this is the current page, or the current page is nested under it (e.g. /events/12 under /events). */
function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Top bar on sm+ (desktop), sticky bottom tab bar below sm (phone) — RSVPs
 * happen on a phone between classes, so the primary nav has to be reachable
 * one-handed without scrolling back up.
 */
export function MemberNav({ user }: { user: SessionUser }) {
  const exec = isExec(user);
  const pathname = usePathname();

  return (
    <>
      <header className="sticky top-0 z-40 hidden border-b-2 border-navy-900/10 bg-white/95 backdrop-blur-sm sm:block">
        <Container>
          <div className="flex h-16 items-center justify-between">
            <Link href="/dashboard" className="flex items-center gap-2.5">
              <Image src="/brand/logo.png" alt="" width={34} height={34} className="h-8 w-8 rounded-full" />
              <span className="font-display text-sm font-extrabold uppercase text-navy-900">
                Member Area
              </span>
            </Link>

            <nav className="flex items-center gap-7">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={cn(
                    "font-display text-xs uppercase tracking-[0.12em] transition-colors hover:text-navy-900",
                    isActivePath(pathname, l.href)
                      ? "font-extrabold text-navy-900"
                      : "font-semibold text-ink/60",
                  )}
                >
                  {l.label}
                </Link>
              ))}
              {exec && (
                <Link
                  href="/exec"
                  className={cn(
                    "flex items-center gap-1.5 font-display text-xs uppercase tracking-[0.12em] transition-colors hover:text-gold-500",
                    isActivePath(pathname, "/exec")
                      ? "font-extrabold text-gold-500"
                      : "font-semibold text-gold-600",
                  )}
                >
                  <ShieldCheck size={14} /> Exec
                </Link>
              )}
            </nav>

            <div className="flex items-center gap-4">
              {user.image && (
                <Image src={user.image} alt="" width={30} height={30} className="h-[30px] w-[30px]" />
              )}
              <SignOutButton className="text-ink/50 hover:text-ink" />
            </div>
          </div>
        </Container>
      </header>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid border-t-2 border-navy-900/10 bg-white/95 backdrop-blur-sm sm:hidden"
        style={{ gridTemplateColumns: `repeat(${exec ? 5 : 4}, 1fr)` }}
      >
        {links.map((l) => {
          const active = isActivePath(pathname, l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "flex flex-col items-center gap-1 py-2.5 transition-colors active:text-navy-900",
                active ? "text-navy-900" : "text-ink/60",
              )}
            >
              <l.icon size={20} strokeWidth={active ? 2.75 : 2} />
              <span className={cn("text-[10px] uppercase tracking-wide", active ? "font-extrabold" : "font-semibold")}>
                {l.label}
              </span>
            </Link>
          );
        })}
        {exec && (
          <Link
            href="/exec"
            className={cn(
              "flex flex-col items-center gap-1 py-2.5 transition-colors active:text-gold-500",
              isActivePath(pathname, "/exec") ? "text-gold-500" : "text-gold-600",
            )}
          >
            <ShieldCheck size={20} strokeWidth={isActivePath(pathname, "/exec") ? 2.75 : 2} />
            <span
              className={cn(
                "text-[10px] uppercase tracking-wide",
                isActivePath(pathname, "/exec") ? "font-extrabold" : "font-semibold",
              )}
            >
              Exec
            </span>
          </Link>
        )}
      </nav>
    </>
  );
}
