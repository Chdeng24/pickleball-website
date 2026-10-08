"use client";

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export type TeamCard = {
  name: string;
  withdrawn: boolean;
  players: { name: string; skill: string; captain: boolean }[];
  rank: string | null;
  record: string | null;
  games: string | null;
  points: string | null;
  seed: number | null;
  recent: { label: string; opponent: string; outcome: "W" | "L" | "—"; detail: string }[];
  next: { label: string; opponent: string; when: string | null } | null;
};

const Cards = createContext<Record<string, TeamCard> | null>(null);

/** Hands every TeamName under it its card — sent once per league, not once per name. */
export function TeamCardsProvider({ cards, children }: { cards: Record<string, TeamCard>; children: ReactNode }) {
  return <Cards.Provider value={cards}>{children}</Cards.Provider>;
}

const GUTTER = 16;
const GAP = 6;
const HOVER_DELAY = 120;

/**
 * A team name you can hover (or tap, or focus) for the team's card. With no
 * card for the id — a bye, TBD, or a page without the provider — it's plain text.
 */
export function TeamName({ teamId, name, className }: { teamId: string | null | undefined; name: string; className?: string }) {
  const card = useContext(Cards)?.[teamId ?? ""];
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const id = useId();

  const close = useCallback(() => {
    clearTimeout(timer.current);
    setOpen(false);
    setPinned(false);
    setPos(null);
  }, []);
  const later = (fn: () => void) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(fn, HOVER_DELAY);
  };

  // Place it under the name — above if there's no room — and keep it inside the screen.
  useLayoutEffect(() => {
    if (!open || !trigger.current || !panel.current) return;
    const r = trigger.current.getBoundingClientRect();
    const { offsetWidth: w, offsetHeight: h } = panel.current;
    const below = r.bottom + GAP;
    const top = below + h > window.innerHeight - GUTTER && r.top - GAP - h > GUTTER ? r.top - GAP - h : below;
    const left = Math.min(Math.max(r.left, GUTTER), window.innerWidth - w - GUTTER);
    setPos({ top, left: Math.max(GUTTER, left) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!trigger.current?.contains(t) && !panel.current?.contains(t)) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, close]);

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!card) return <span className={className}>{name}</span>;

  const hover = (e: ReactPointerEvent) => e.pointerType === "mouse";

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onPointerEnter={(e) => hover(e) && !pinned && later(() => setOpen(true))}
        onPointerLeave={(e) => hover(e) && !pinned && later(close)}
        onClick={() => {
          clearTimeout(timer.current);
          if (pinned) close();
          else {
            setOpen(true);
            setPinned(true);
          }
        }}
        onFocus={() => setOpen(true)}
        onBlur={(e) => !pinned && !panel.current?.contains(e.relatedTarget as Node) && close()}
        className={cn(
          "cursor-pointer text-left decoration-dotted decoration-navy-900/40 underline-offset-4 hover:underline focus-visible:underline",
          className,
        )}
      >
        {name}
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="dialog"
            aria-label={`${card.name} — team info`}
            onPointerEnter={(e) => hover(e) && clearTimeout(timer.current)}
            onPointerLeave={(e) => hover(e) && !pinned && later(close)}
            style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
            className="fixed z-50 w-80 max-w-[calc(100vw-32px)] border-2 border-navy-900 bg-white text-left text-sm font-normal normal-case tracking-normal text-ink shadow-[4px_4px_0_0_var(--color-gold-500)]"
          >
            <TeamCardBody card={card} />
          </div>,
          document.body,
        )}
    </>
  );
}

function TeamCardBody({ card }: { card: TeamCard }) {
  return (
    <>
      <div className="flex items-start justify-between gap-2 border-b-2 border-navy-900/10 p-3">
        <p className="font-display text-base font-extrabold uppercase leading-tight text-navy-900">{card.name}</p>
        {card.withdrawn ? (
          <span className="shrink-0 bg-navy-900/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-ink/60">Withdrawn</span>
        ) : card.seed ? (
          <span className="shrink-0 bg-gold-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-navy-900">Seed {card.seed}</span>
        ) : null}
      </div>

      <ul className="space-y-1 p-3">
        {card.players.length === 0 && <li className="text-ink/50">No players listed.</li>}
        {card.players.map((p, i) => (
          <li key={i} className="flex items-baseline justify-between gap-2">
            <span className="font-semibold text-navy-900">
              {p.name}
              {p.captain && <span className="ml-1.5 text-[10px] font-bold uppercase text-ink/40">Captain</span>}
            </span>
            <span className="shrink-0 text-xs text-ink/50">{p.skill}</span>
          </li>
        ))}
      </ul>

      {card.record && (
        <dl className="grid grid-cols-4 border-y-2 border-navy-900/10 bg-chalk text-center">
          {[
            ["Rank", card.rank],
            ["W-L", card.record],
            ["Games", card.games ?? "—"],
            ["Points", card.points ?? "—"],
          ].map(([k, v]) => (
            <div key={k} className="px-1 py-2">
              <dt className="text-[10px] font-bold uppercase tracking-wide text-ink/45">{k}</dt>
              <dd className="font-semibold text-navy-900">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {card.recent.length > 0 && (
        <div className="p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink/45">Recent</p>
          <ul className="mt-1 space-y-1">
            {card.recent.map((r) => (
              <li key={r.label} className="flex items-baseline gap-2 text-xs">
                <span
                  className={cn(
                    "w-5 shrink-0 text-center text-[10px] font-bold",
                    r.outcome === "W" ? "bg-gold-500 text-navy-900" : "bg-navy-900/10 text-ink/60",
                  )}
                >
                  {r.outcome}
                </span>
                <span className="min-w-0 flex-1 truncate text-navy-900">vs {r.opponent}</span>
                <span className="shrink-0 text-ink/50">{r.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {card.next && (
        <div className={cn("p-3", card.recent.length > 0 && "border-t border-navy-900/5")}>
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink/45">Next · {card.next.label}</p>
          <p className="mt-0.5 font-semibold text-navy-900">vs {card.next.opponent}</p>
          {card.next.when && <p className="text-xs text-ink/50">{card.next.when}</p>}
        </div>
      )}
    </>
  );
}
