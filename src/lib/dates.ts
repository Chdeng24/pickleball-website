/**
 * All event timestamps are stored as UTC `timestamptz`. This is the one place
 * that formats them for display — always pinned to America/Los_Angeles, never
 * the server's or the visitor's local timezone, so "Tuesday 7pm" means the
 * same thing to every member regardless of where the request runs.
 */
const TZ = "America/Los_Angeles";

const dayFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  weekday: "short",
  month: "short",
  day: "numeric",
});

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hour: "numeric",
  minute: "2-digit",
});

const tzLabelFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  timeZoneName: "short",
});

/** "PT" / "PDT" / "PST" for the given instant — daylight saving changes it. */
export function tzLabel(date: Date): string {
  return tzLabelFmt.formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? "PT";
}

/** "Tue, Feb 3 · 7:00 – 9:00 PM PST" */
export function formatEventWhen(startsAt: Date, endsAt: Date): string {
  const day = dayFmt.format(startsAt);
  const start = timeFmt.format(startsAt);
  const end = timeFmt.format(endsAt);
  return `${day} · ${start} – ${end} ${tzLabel(startsAt)}`;
}

/** "Tue, Feb 3" — no time, for compact list rows. */
export function formatEventDay(date: Date): string {
  return dayFmt.format(date);
}

/** "7:00 PM" — no date, for a detail page that already shows the day once. */
export function formatEventTime(date: Date): string {
  return `${timeFmt.format(date)} ${tzLabel(date)}`;
}

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Pacific calendar date (year/month/day) an instant falls on — for placing an event on a calendar grid, not display. */
export function pacificDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = Object.fromEntries(partsFmt.formatToParts(date).map((p) => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

/** "2026-02-03" — sortable/comparable key for the Pacific calendar day an instant falls on. */
export function pacificDateKey(date: Date): string {
  const { year, month, day } = pacificDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Group a list of events by their Pacific calendar day, preserving order. */
export function groupByDay<T extends { startsAt: Date }>(events: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const event of events) {
    const key = formatEventDay(event.startsAt);
    const group = groups.get(key);
    if (group) group.push(event);
    else groups.set(key, [event]);
  }
  return [...groups.entries()];
}

/**
 * Convert a `<input type="datetime-local">` value (a plain "YYYY-MM-DDTHH:mm"
 * with no timezone) into the UTC instant it represents *as Pacific time*.
 *
 * This is the one place exec's event form input gets attached to a timezone.
 * `new Date(str)` alone would parse using the server's local timezone (UTC in
 * most deployments), silently shifting every event by 7-8 hours — exactly the
 * bug the project's timezone rule exists to prevent.
 */
export function laInputToUtc(localValue: string): Date {
  // First guess: treat the string as if it were already UTC.
  const guess = new Date(`${localValue}:00Z`);

  // See what wall-clock time that instant actually shows in Los Angeles.
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(guess)
      .map((p) => [p.type, p.value]),
  );
  const shownAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
  );

  // The gap between the guess and what LA actually shows IS the UTC offset
  // (a whole number of hours for America/Los_Angeles), so one correction is exact.
  return new Date(guess.getTime() + (guess.getTime() - shownAsUtc));
}

/** Inverse of laInputToUtc — pre-fills a datetime-local input from a stored UTC date. */
export function utcToLaInputValue(date: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
