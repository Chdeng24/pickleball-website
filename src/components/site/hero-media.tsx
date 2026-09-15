"use client";

import { useEffect, useState } from "react";

/**
 * Background media for the hero.
 *
 * Deliberate behaviour:
 *  - Video only mounts on >=768px viewports AND when the user hasn't asked for
 *    reduced motion. Phones get the still poster instead — no autoplay video
 *    burning cellular data or battery on a signup page.
 *  - If /media/hero.mp4 is absent (it is, until drone footage arrives) the
 *    designed court-line placeholder below shows through untouched.
 */
export function HeroMedia() {
  const [showVideo, setShowVideo] = useState(false);

  useEffect(() => {
    const wide = window.matchMedia("(min-width: 768px)");
    const calm = window.matchMedia("(prefers-reduced-motion: no-preference)");
    const update = () => setShowVideo(wide.matches && calm.matches);
    update();
    wide.addEventListener("change", update);
    calm.addEventListener("change", update);
    return () => {
      wide.removeEventListener("change", update);
      calm.removeEventListener("change", update);
    };
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden bg-navy-900">
      <CourtPlaceholder />

      {showVideo && (
        <video
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster="/media/hero-poster.jpg"
          className="absolute inset-0 h-full w-full object-cover"
        >
          {/* TODO: drop drone footage here — see README for encoding settings */}
          <source src="/media/hero.webm" type="video/webm" />
          <source src="/media/hero.mp4" type="video/mp4" />
        </video>
      )}

      {/* Legibility scrim: dark at the bottom where the headline sits */}
      <div className="absolute inset-0 bg-gradient-to-t from-navy-950 via-navy-950/55 to-navy-950/35" />
      <div className="absolute inset-0 bg-gradient-to-r from-navy-950/85 via-transparent to-transparent" />
    </div>
  );
}

/** Stylised pickleball court, drawn in SVG. Stands in for the drone shot. */
function CourtPlaceholder() {
  return (
    <div className="absolute inset-0">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_60%_35%,var(--color-navy-700),var(--color-navy-950)_70%)]" />
      <svg
        className="absolute inset-0 h-full w-full opacity-[0.18]"
        viewBox="0 0 1200 700"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <g
          fill="none"
          stroke="white"
          strokeWidth="2.5"
          transform="translate(600 350) rotate(-14) skewX(-16) translate(-600 -350)"
        >
          <rect x="250" y="120" width="700" height="460" />
          <line x1="250" y1="350" x2="950" y2="350" />
          <rect x="250" y="225" width="700" height="250" strokeDasharray="0" />
          <line x1="600" y1="120" x2="600" y2="225" />
          <line x1="600" y1="475" x2="600" y2="580" />
        </g>
      </svg>
    </div>
  );
}
