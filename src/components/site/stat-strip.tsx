"use client";

import { useRef } from "react";
import { useInView } from "motion/react";
import NumberFlow from "@number-flow/react";
import { stats } from "@/lib/content";
import { Container } from "@/components/ui/container";

/** Gold band of animated counters that tick up as it scrolls into view. */
export function StatStrip() {
  const ref = useRef<HTMLDivElement>(null);
  // `once: true` latches this to true on first sight, so it doubles as the
  // "has the counter started" flag — no extra state needed.
  const live = useInView(ref, { once: true, margin: "-60px" });

  return (
    <section ref={ref} className="bg-gold-500 text-navy-900">
      <Container>
        <dl className="grid grid-cols-2 divide-navy-900/15 py-10 sm:py-12 lg:grid-cols-4 lg:divide-x">
          {stats.map((s) => (
            <div key={s.label} className="px-2 py-5 text-center lg:px-6">
              <dd className="font-display text-4xl font-extrabold tabular-nums sm:text-5xl lg:text-6xl">
                <NumberFlow
                  value={live ? s.value : 0}
                  format={s.plain ? { useGrouping: false } : undefined}
                />
                {s.suffix}
              </dd>
              <dt className="kicker mt-3 block text-navy-900/70">{s.label}</dt>
            </div>
          ))}
        </dl>
      </Container>
    </section>
  );
}
