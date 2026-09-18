"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, MapPin, Users } from "lucide-react";
import { pacificDateKey, pacificDateParts, formatEventTime } from "@/lib/dates";
import { cn } from "@/lib/utils";

type EventRow = {
  id: string;
  title: string;
  location: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number | null;
};
type RsvpRow = { status: "confirmed" | "waitlist" | "cancelled"; position: number };

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function monthLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** Cells for a full month grid, padded to whole weeks (Sun-start), using the *local* browser calendar — the grid is just a shape, actual event placement uses pacificDateKey below. */
function monthCells(year: number, month: number): { year: number; month: number; day: number; inMonth: boolean }[] {
  const first = new Date(year, month - 1, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const daysInPrevMonth = new Date(year, month - 1, 0).getDate();

  const cells: { year: number; month: number; day: number; inMonth: boolean }[] = [];

  for (let i = startWeekday - 1; i >= 0; i--) {
    const m = month - 1 === 0 ? 12 : month - 1;
    const y = month - 1 === 0 ? year - 1 : year;
    cells.push({ year: y, month: m, day: daysInPrevMonth - i, inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ year, month, day: d, inMonth: true });
  }
  while (cells.length % 7 !== 0 || cells.length < 42) {
    const last = cells[cells.length - 1];
    const nextDay = last.day + 1;
    const daysInLastMonth = new Date(last.year, last.month, 0).getDate();
    if (nextDay > daysInLastMonth) {
      const m = last.month === 12 ? 1 : last.month + 1;
      const y = last.month === 12 ? last.year + 1 : last.year;
      cells.push({ year: y, month: m, day: 1, inMonth: false });
    } else {
      cells.push({ year: last.year, month: last.month, day: nextDay, inMonth: false });
    }
    if (cells.length >= 42) break;
  }
  return cells;
}

export function EventsCalendar({
  events,
  rsvpByEvent = new Map(),
}: {
  events: EventRow[];
  rsvpByEvent?: Map<string, RsvpRow>;
}) {
  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventRow[]>();
    for (const e of events) {
      const key = pacificDateKey(e.startsAt);
      const group = map.get(key);
      if (group) group.push(e);
      else map.set(key, [e]);
    }
    return map;
  }, [events]);

  const today = pacificDateParts(new Date());
  const firstEventDay = events.length > 0 ? pacificDateParts(events[0].startsAt) : today;

  const [cursor, setCursor] = useState({ year: firstEventDay.year, month: firstEventDay.month });
  const [selected, setSelected] = useState(pacificDateKey(events[0]?.startsAt ?? new Date()));

  const cells = useMemo(() => monthCells(cursor.year, cursor.month), [cursor]);
  const todayKey = `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`;
  const selectedEvents = eventsByDay.get(selected) ?? [];

  function changeMonth(delta: number) {
    setCursor((c) => {
      let month = c.month + delta;
      let year = c.year;
      if (month > 12) {
        month = 1;
        year++;
      } else if (month < 1) {
        month = 12;
        year--;
      }
      return { year, month };
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-extrabold uppercase text-navy-900">
          {monthLabel(cursor.year, cursor.month)}
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => changeMonth(-1)}
            aria-label="Previous month"
            className="flex h-8 w-8 items-center justify-center border-2 border-navy-900/15 text-navy-900 hover:border-navy-900"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => changeMonth(1)}
            aria-label="Next month"
            className="flex h-8 w-8 items-center justify-center border-2 border-navy-900/15 text-navy-900 hover:border-navy-900"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase text-ink/40">
        {WEEKDAYS.map((w, i) => (
          <div key={i}>{w}</div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          const key = `${c.year}-${String(c.month).padStart(2, "0")}-${String(c.day).padStart(2, "0")}`;
          const dayEvents = eventsByDay.get(key) ?? [];
          const isToday = key === todayKey;
          const isSelected = key === selected;

          return (
            <button
              key={i}
              type="button"
              disabled={!c.inMonth}
              onClick={() => setSelected(key)}
              className={cn(
                "flex aspect-square flex-col items-center justify-center gap-1 border-2 text-sm transition-colors",
                !c.inMonth && "border-transparent text-ink/20",
                c.inMonth && !isSelected && "border-navy-900/10 text-navy-900 hover:border-navy-900/40",
                isSelected && "border-navy-900 bg-navy-900 text-white",
                isToday && !isSelected && "border-gold-500",
              )}
            >
              <span className="font-semibold">{c.day}</span>
              {dayEvents.length > 0 && <span className="h-1 w-3 bg-gold-500" aria-hidden />}
            </button>
          );
        })}
      </div>

      <div className="mt-6 space-y-3">
        {selectedEvents.length === 0 ? (
          <div className="border-2 border-dashed border-navy-900/15 bg-white p-6 text-center text-sm text-ink/50">
            Nothing on this day.
          </div>
        ) : (
          selectedEvents.map((event) => {
            const mine = rsvpByEvent.get(event.id);
            return (
              <Link
                key={event.id}
                href={`/events/${event.id}`}
                className="flex items-center justify-between gap-4 border-2 border-navy-900/10 bg-white p-5 transition-colors hover:border-navy-900"
              >
                <div className="min-w-0">
                  <p className="font-display text-base font-bold uppercase text-navy-900">{event.title}</p>
                  <p className="mt-1 text-sm text-ink/60">{formatEventTime(event.startsAt)}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink/45">
                    <MapPin size={12} /> {event.location}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  {mine?.status === "confirmed" && (
                    <span className="bg-navy-900 px-2.5 py-1 text-xs font-bold uppercase text-gold-500">
                      You&apos;re in
                    </span>
                  )}
                  {mine?.status === "waitlist" && (
                    <span className="bg-ink/10 px-2.5 py-1 text-xs font-bold uppercase text-ink/60">
                      Waitlist #{mine.position}
                    </span>
                  )}
                  {!mine && event.capacity !== null && (
                    <span className="flex items-center gap-1 text-xs text-ink/40">
                      <Users size={12} /> cap {event.capacity}
                    </span>
                  )}
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
