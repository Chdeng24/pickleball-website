"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Menu, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { nav, club } from "@/lib/content";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Header() {
  // Transparent over the hero, solid once the user scrolls past it.
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lock body scroll while the mobile sheet is open.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-300",
        scrolled
          ? "bg-navy-900/95 backdrop-blur-md shadow-lg shadow-navy-950/20"
          : "bg-gradient-to-b from-navy-950/70 to-transparent",
      )}
    >
      <Container>
        <div className="flex h-18 items-center justify-between py-3 sm:h-20">
          <Link href="/" className="flex items-center gap-3" onClick={() => setOpen(false)}>
            <Image
              src="/brand/logo.png"
              alt=""
              width={48}
              height={48}
              priority
              className="h-11 w-11 rounded-full sm:h-12 sm:w-12"
            />
            <span className="font-display text-sm font-extrabold uppercase leading-[1.1] tracking-tight text-white sm:text-base">
              Pickleball
              <br />
              <span className="text-gold-500">at Berkeley</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-8 lg:flex">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="font-display text-xs font-semibold uppercase tracking-[0.14em] text-white/80 transition-colors hover:text-gold-500"
              >
                {item.label}
              </Link>
            ))}
            <Button href="/login" variant="gold" size="sm">
              Member Login
            </Button>
          </nav>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-white lg:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
          >
            {open ? <X size={26} /> : <Menu size={26} />}
          </button>
        </div>
      </Container>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="border-t border-white/10 bg-navy-900 lg:hidden"
          >
            <Container>
              <nav className="flex flex-col py-4">
                {nav.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="border-b border-white/10 py-4 font-display text-lg font-bold uppercase tracking-tight text-white transition-colors hover:text-gold-500"
                  >
                    {item.label}
                  </Link>
                ))}
                <Button href="/login" variant="gold" size="lg" className="mt-5 w-full">
                  Member Login
                </Button>
                <p className="py-5 text-center text-xs text-white/40">{club.email}</p>
              </nav>
            </Container>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
