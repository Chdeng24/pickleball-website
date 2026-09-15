import Link from "next/link";
import Image from "next/image";
import { Mail } from "lucide-react";
import { InstagramIcon } from "@/components/ui/icons";
import { club, nav } from "@/lib/content";
import { Container } from "@/components/ui/container";

export function Footer() {
  return (
    <footer className="bg-navy-950 text-white">
      <Container className="py-16">
        <div className="grid gap-12 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-3">
              <Image
                src="/brand/logo.png"
                alt=""
                width={56}
                height={56}
                className="h-14 w-14 rounded-full"
              />
              <span className="font-display text-lg font-extrabold uppercase leading-[1.1] tracking-tight">
                Pickleball
                <br />
                <span className="text-gold-500">at Berkeley</span>
              </span>
            </div>
            <p className="mt-6 max-w-sm text-sm leading-relaxed text-white/55">
              {club.blurb}
            </p>
          </div>

          <div>
            <h3 className="kicker text-gold-500">Explore</h3>
            <ul className="mt-5 space-y-3">
              {nav.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-sm text-white/65 transition-colors hover:text-gold-500"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="kicker text-gold-500">Connect</h3>
            <ul className="mt-5 space-y-3">
              <li>
                <a
                  href={`mailto:${club.email}`}
                  className="inline-flex items-center gap-2 text-sm text-white/65 transition-colors hover:text-gold-500"
                >
                  <Mail size={16} /> {club.email}
                </a>
              </li>
              <li>
                <a
                  href={club.instagram}
                  className="inline-flex items-center gap-2 text-sm text-white/65 transition-colors hover:text-gold-500"
                >
                  <InstagramIcon size={16} /> Instagram
                </a>
              </li>
              <li>
                <Link
                  href="/sponsors"
                  className="inline-flex items-center gap-2 text-sm text-white/65 transition-colors hover:text-gold-500"
                >
                  Partner with us
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-white/10 pt-7 text-xs text-white/35 sm:flex-row sm:items-center sm:justify-between">
          <p>
            &copy; {new Date().getFullYear()} {club.name}. A registered student
            organization at UC Berkeley.
          </p>
          <p>Not an official University of California publication.</p>
        </div>
      </Container>
    </footer>
  );
}
