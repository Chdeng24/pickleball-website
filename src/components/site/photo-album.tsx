"use client";

import { useCallback, useEffect, useState, type CSSProperties, type KeyboardEvent } from "react";
import Image from "next/image";
import useEmblaCarousel from "embla-carousel-react";
import Autoplay from "embla-carousel-autoplay";
import Lightbox from "yet-another-react-lightbox";
import Captions from "yet-another-react-lightbox/plugins/captions";
import Thumbnails from "yet-another-react-lightbox/plugins/thumbnails";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/captions.css";
import "yet-another-react-lightbox/plugins/thumbnails.css";
import { Camera, ChevronLeft, ChevronRight, Expand } from "lucide-react";
import type { AlbumPhoto } from "@/lib/content";
import { cn } from "@/lib/utils";

const AUTOPLAY_MS = 5000;
/** Widths and quality (75) Next 16 serves by default — anything else is rejected with a 400. */
const LIGHTBOX_WIDTHS = [1080, 1920];

/**
 * A photo album: a swipeable strip where the centered photo is in focus and
 * captioned, auto-advancing (paused on hover, off for reduced motion), and a
 * full-screen lightbox with zoom and thumbnails on tap. Photos keep their own
 * shape — group shots are never cropped.
 */
export function PhotoAlbum({ photos, label }: { photos: AlbumPhoto[]; label: string }) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: photos.length > 2, align: "center", containScroll: false, skipSnaps: true }, [
    Autoplay({ delay: AUTOPLAY_MS, stopOnInteraction: false, stopOnMouseEnter: true, playOnInit: false }),
  ]);
  const [selected, setSelected] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [lightbox, setLightbox] = useState(-1);

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => setSelected(emblaApi.selectedScrollSnap());
    const autoplay = emblaApi.plugins().autoplay;
    const onPlay = () => setPlaying(true);
    const onStop = () => setPlaying(false);
    emblaApi.on("select", onSelect).on("autoplay:play", onPlay).on("autoplay:stop", onStop);
    onSelect();
    if (photos.length > 1 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) autoplay?.play();
    return () => {
      emblaApi.off("select", onSelect).off("autoplay:play", onPlay).off("autoplay:stop", onStop);
    };
  }, [emblaApi, photos.length]);

  // Don't advance behind the lightbox.
  useEffect(() => {
    const autoplay = emblaApi?.plugins().autoplay;
    if (!autoplay) return;
    if (lightbox >= 0) autoplay.stop();
    else if (photos.length > 1 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) autoplay.play();
  }, [lightbox, emblaApi, photos.length]);

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);
  const scrollTo = useCallback((i: number) => emblaApi?.scrollTo(i), [emblaApi]);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") scrollPrev();
    if (e.key === "ArrowRight") scrollNext();
  };

  if (photos.length === 0) return <AlbumPlaceholder />;

  const current = photos[selected] ?? photos[0];
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <div className="relative" role="region" aria-roledescription="carousel" aria-label={label}>
      <div
        ref={emblaRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="overflow-hidden outline-none [--album-h:300px] focus-visible:ring-2 focus-visible:ring-gold-500 sm:[--album-h:440px] lg:[--album-h:520px]"
      >
        <div className="flex items-center" style={{ touchAction: "pan-y pinch-zoom" }}>
          {photos.map((photo, i) => {
            const active = i === selected;
            return (
              <div
                key={photo.src}
                className="min-w-0 shrink-0 pl-3 sm:pl-5"
                role="group"
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${photos.length}`}
              >
                <button
                  type="button"
                  onClick={() => (active ? setLightbox(i) : scrollTo(i))}
                  aria-label={active ? `Open “${photo.caption}” full screen` : `Show “${photo.caption}”`}
                  className={cn(
                    "group relative block overflow-hidden bg-navy-800 transition-[opacity,transform] duration-500 ease-out",
                    active ? "scale-100 opacity-100" : "scale-[0.9] opacity-40 hover:opacity-70",
                    active ? "cursor-zoom-in" : "cursor-pointer",
                  )}
                  style={
                    {
                      width: `min(84vw, calc(var(--album-h) * ${photo.width / photo.height}))`,
                      aspectRatio: `${photo.width} / ${photo.height}`,
                    } as CSSProperties
                  }
                >
                  <Image
                    src={photo.src}
                    alt={photo.alt}
                    fill
                    sizes="(min-width: 1024px) 45vw, 84vw"
                    className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
                    priority={i === 0}
                  />
                  <span
                    className={cn(
                      "absolute inset-x-0 bottom-0 bg-gradient-to-t from-navy-900/85 via-navy-900/30 to-transparent px-4 pb-3 pt-12 text-left transition-opacity duration-500",
                      active ? "opacity-100" : "opacity-0",
                    )}
                  >
                    <span className="block font-display text-sm font-bold uppercase tracking-wide text-white sm:text-base">{photo.caption}</span>
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "absolute right-3 top-3 flex h-8 w-8 items-center justify-center bg-navy-900/70 text-white opacity-0 transition-opacity duration-300",
                      active && "group-hover:opacity-100 group-focus-visible:opacity-100",
                    )}
                  >
                    <Expand size={15} />
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mx-auto mt-6 flex max-w-3xl flex-wrap items-center justify-between gap-4 px-1">
        <p className="font-display text-sm font-bold tabular-nums text-navy-900" aria-live="polite">
          {pad(selected + 1)} <span className="text-ink/30">/ {pad(photos.length)}</span>
          <span className="sr-only"> — {current.caption}</span>
        </p>

        {photos.length > 1 && (
          <div className="order-last flex w-full gap-1.5 sm:order-none sm:w-auto">
            {photos.map((photo, i) => (
              <button
                key={photo.src}
                type="button"
                onClick={() => scrollTo(i)}
                aria-label={`Go to photo ${i + 1}`}
                className="relative h-1.5 flex-1 overflow-hidden bg-navy-900/15 sm:w-8 sm:flex-none"
              >
                {i < selected && <span className="absolute inset-0 bg-navy-900/40" />}
                {i === selected && (
                  <span
                    key={`${selected}-${playing}`}
                    className="album-progress absolute inset-0 origin-left bg-gold-500"
                    style={{ animationDuration: `${AUTOPLAY_MS}ms`, animationPlayState: playing ? "running" : "paused" }}
                  />
                )}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          {photos.length > 1 && (
            <>
              <AlbumButton onClick={scrollPrev} label="Previous photo">
                <ChevronLeft size={18} />
              </AlbumButton>
              <AlbumButton onClick={scrollNext} label="Next photo">
                <ChevronRight size={18} />
              </AlbumButton>
            </>
          )}
          <button
            type="button"
            onClick={() => setLightbox(selected)}
            className="flex h-9 items-center gap-2 border-2 border-navy-900 bg-navy-900 px-3 text-xs font-bold uppercase tracking-wide text-white transition-colors hover:bg-gold-500 hover:text-navy-900"
          >
            <Expand size={14} /> Fullscreen
          </button>
        </div>
      </div>

      <Lightbox
        open={lightbox >= 0}
        index={Math.max(0, lightbox)}
        close={() => setLightbox(-1)}
        on={{ view: ({ index }) => emblaApi?.scrollTo(index, true) }}
        slides={photos.map((p) => ({
          src: p.src,
          alt: p.alt,
          title: p.caption,
          width: p.width,
          height: p.height,
          srcSet: LIGHTBOX_WIDTHS.filter((w) => w < p.width).map((w) => ({
            src: `/_next/image?url=${encodeURIComponent(p.src)}&w=${w}&q=75`,
            width: w,
            height: Math.round((w * p.height) / p.width),
          })),
        }))}
        plugins={[Captions, Thumbnails, Zoom]}
        carousel={{ finite: photos.length <= 2 }}
        controller={{ closeOnBackdropClick: true }}
        thumbnails={{ border: 2, borderRadius: 0, padding: 0, gap: 8, width: 96, height: 64, imageFit: "cover" }}
        zoom={{ maxZoomPixelRatio: 2 }}
        styles={{
          root: { "--yarl__color_backdrop": "rgb(7, 29, 69)" },
          container: { backgroundColor: "rgb(7, 29, 69)" },
          thumbnailsContainer: { backgroundColor: "rgb(7, 29, 69)" },
          thumbnail: {
            backgroundColor: "transparent",
            borderColor: "transparent",
            "--yarl__thumbnails_thumbnail_active_border_color": "var(--color-gold-500)",
          },
        }}
      />
    </div>
  );
}

function AlbumButton({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center border-2 border-navy-900/15 text-navy-900 transition-colors hover:border-navy-900 hover:bg-navy-900 hover:text-white"
    >
      {children}
    </button>
  );
}

/** On-brand "coming soon" grid while an album has no photos yet. */
function AlbumPlaceholder() {
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
              <span className="px-2 text-[11px] font-semibold uppercase tracking-wide text-white/70">Photos coming soon</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
