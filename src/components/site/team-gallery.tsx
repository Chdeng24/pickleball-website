"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import useEmblaCarousel from "embla-carousel-react";
import Autoplay from "embla-carousel-autoplay";
import { ChevronLeft, ChevronRight, Camera } from "lucide-react";
import { galleryPhotos } from "@/lib/content";

/**
 * Auto-advancing photo carousel. Empty until `galleryPhotos` in content.ts
 * has entries — see the comment there for how to add one — in which case it
 * shows an on-brand "coming soon" placeholder instead of a blank section.
 */
export function TeamGallery() {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true, align: "center" }, [
    Autoplay({ delay: 4500, stopOnInteraction: false }),
  ]);
  const [selected, setSelected] = useState(0);

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);
  const scrollTo = useCallback((i: number) => emblaApi?.scrollTo(i), [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => setSelected(emblaApi.selectedScrollSnap());
    emblaApi.on("select", onSelect);
    onSelect();
    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi]);

  if (galleryPhotos.length === 0) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="relative aspect-square overflow-hidden bg-navy-800">
            <div
              aria-hidden
              className="absolute inset-0 opacity-[0.08]"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(45deg, var(--color-gold-500) 0, var(--color-gold-500) 1px, transparent 1px, transparent 12px)",
              }}
            />
            {i === 3 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
                <Camera size={22} className="text-gold-500" />
                <span className="px-2 text-[11px] font-semibold uppercase tracking-wide text-white/70">
                  Photos coming soon
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Fades the strip to transparent at both edges instead of a hard crop. */}
      <div
        className="overflow-hidden"
        style={{
          maskImage: "linear-gradient(to right, transparent, black 8%, black 92%, transparent)",
          WebkitMaskImage: "linear-gradient(to right, transparent, black 8%, black 92%, transparent)",
        }}
        ref={emblaRef}
      >
        <div className="flex">
          {galleryPhotos.map((photo, i) => (
            <div key={photo.src} className="relative mr-2 aspect-[4/3] w-[78%] shrink-0 sm:w-[45%] lg:w-[32%]">
              <div className="relative h-full w-full overflow-hidden bg-navy-800">
                <Image
                  src={photo.src}
                  alt={photo.alt}
                  fill
                  sizes="(min-width: 1024px) 32vw, (min-width: 640px) 45vw, 78vw"
                  className="object-cover"
                  priority={i === 0}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={scrollPrev}
          aria-label="Previous photo"
          className="flex h-9 w-9 items-center justify-center border-2 border-navy-900/15 text-navy-900 transition-colors hover:border-navy-900 hover:bg-navy-900 hover:text-white"
        >
          <ChevronLeft size={18} />
        </button>

        <div className="flex items-center gap-1.5">
          {galleryPhotos.map((photo, i) => (
            <button
              key={photo.src}
              type="button"
              onClick={() => scrollTo(i)}
              aria-label={`Go to photo ${i + 1}`}
              className={`h-1.5 w-5 transition-colors ${i === selected ? "bg-gold-500" : "bg-navy-900/15"}`}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={scrollNext}
          aria-label="Next photo"
          className="flex h-9 w-9 items-center justify-center border-2 border-navy-900/15 text-navy-900 transition-colors hover:border-navy-900 hover:bg-navy-900 hover:text-white"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
