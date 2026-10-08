/**
 * Pickleball League season schedule — pure, no DB, so every rule is unit
 * tested (schedule.test.ts).
 *
 * The season is a weekly round robin: every team plays exactly one match a
 * week against a different opponent, for `roundRobinWeeks` weeks. Each week
 * has two cut-offs: post when you're playing by Wednesday 11:59 PM, and
 * play and report the score by the Sunday after the week, 11:59 PM.
 * The whole league is one table — not pools — so with an even number of
 * slots nobody ever sits out a week.
 *
 * "Slots" are what the schedule is built on. Each slot is a real team or an
 * open slot (a placeholder team). Whoever is drawn against an open slot that
 * week has a bye. A team that joins late takes over an open slot and inherits
 * its remaining matches, so nobody else's matchups move.
 *
 * After the round robin: `catchupWeeks` with no new matches (makeups only —
 * Thanksgiving week by default), then single elimination, one round a week,
 * ending in a final on `finalOn`.
 */
import { laDeadlineToUtc, laInputToUtc, pacificDateKey } from "./dates.ts";

export type Pair = [string, string];

/* ─── Round robin ────────────────────────────────────────────────────────── */

/**
 * Circle method: slot `n-1` stays put and the rest rotate one place a round.
 * Any `rounds` <= n-1 consecutive rounds give every slot exactly one match per
 * round and never the same opponent twice. Needs an even slot count.
 */
export function roundRobinRounds(slots: string[], rounds: number): Pair[][] {
  const n = slots.length;
  if (n < 2 || n % 2 !== 0) throw new Error("Round robin needs an even number of slots.");
  if (rounds > n - 1) throw new Error(`${n} slots only have ${n - 1} distinct rounds.`);

  const m = n - 1;
  const fixed = slots[m];
  const out: Pair[][] = [];
  for (let r = 0; r < rounds; r++) {
    const round: Pair[] = [[fixed, slots[r % m]]];
    for (let k = 1; k < n / 2; k++) {
      round.push([slots[(r + k) % m], slots[(r - k + m) % m]]);
    }
    out.push(round);
  }
  return out;
}

/** Slots needed for `teams` real teams plus `reserved` open slots for late teams — rounded up to even so nobody gets a bye unless a slot is open. */
export function slotCount(teams: number, reserved: number): number {
  const n = teams + reserved;
  return n % 2 === 0 ? n : n + 1;
}

/* ─── Strength balancing ─────────────────────────────────────────────────── */

export type PlayerLevel = "comp" | "advanced" | "beginner" | "unknown";

const LEVEL_SCORE: Record<PlayerLevel, number> = { comp: 3, advanced: 2, unknown: 1.5, beginner: 1 };

/** A rough team rating — only used to spread strong teams across everyone's schedule, never shown. */
export function teamStrength(levels: PlayerLevel[]): number {
  return levels.reduce((sum, l) => sum + LEVEL_SCORE[l], 0);
}

export type SlotTeam = { id: string; strength: number; placeholder?: boolean };

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** How uneven a schedule is: spread between the toughest and easiest real team's total opponent strength. */
export function scheduleSpread(order: SlotTeam[], rounds: number): number {
  const byId = new Map(order.map((t) => [t.id, t]));
  const faced = new Map(order.filter((t) => !t.placeholder).map((t) => [t.id, 0]));
  for (const round of roundRobinRounds(order.map((t) => t.id), rounds)) {
    for (const [a, b] of round) {
      const ta = byId.get(a)!;
      const tb = byId.get(b)!;
      if (!ta.placeholder && !tb.placeholder) {
        faced.set(a, faced.get(a)! + tb.strength);
        faced.set(b, faced.get(b)! + ta.strength);
      }
    }
  }
  const totals = [...faced.values()];
  return totals.length ? Math.max(...totals) - Math.min(...totals) : 0;
}

/**
 * Random slot order, but out of `tries` random draws keep the one where
 * everyone's opponents are closest to equally tough — so nobody's 7 matches
 * are all against Comp Team pairs while someone else gets none.
 */
export function balancedSlotOrder(teams: SlotTeam[], rounds: number, rng: () => number = Math.random, tries = 400): string[] {
  let best: SlotTeam[] = shuffle(teams, rng);
  let bestSpread = scheduleSpread(best, rounds);
  for (let i = 1; i < tries && bestSpread > 0; i++) {
    const candidate = shuffle(teams, rng);
    const spread = scheduleSpread(candidate, rounds);
    if (spread < bestSpread) {
      best = candidate;
      bestSpread = spread;
    }
  }
  return best.map((t) => t.id);
}

/* ─── Calendar ───────────────────────────────────────────────────────────── */

/** "2026-10-05" + 6 → "2026-10-11". Pure calendar arithmetic, no timezone involved. */
export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

function daysBetween(fromKey: string, toKey: string): number {
  const [a, b] = [fromKey, toKey].map((k) => {
    const [y, m, d] = k.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  });
  return Math.round((b - a) / 86_400_000);
}

/** Monday of a season week (1-based), as a date key. */
export function weekMonday(seasonStartsOn: string, week: number): string {
  return addDays(seasonStartsOn, 7 * (week - 1));
}

/**
 * Sunday 11:59 PM Pacific right after a season week (Sun–Sat) — the deadline to
 * play and report that week's match. It's the first day of the next week, so a
 * team that couldn't get together during the week still has the weekend.
 */
export function weekDueBy(seasonStartsOn: string, week: number): Date {
  return laDeadlineToUtc(`${addDays(weekMonday(seasonStartsOn, week), 6)}T23:59`);
}

/** Monday of the calendar week (Mon–Sun) a date key falls in. */
function mondayOf(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(dateKey, -((dow + 6) % 7));
}

/** Which season week an instant falls in (1-based; 0 or less = before the season). Weeks run Sunday to Saturday. */
export function weekOf(seasonStartsOn: string, now: Date): number {
  return Math.floor(daysBetween(addDays(seasonStartsOn, -1), pacificDateKey(now)) / 7) + 1;
}

/** Same Pacific wall-clock deadline, `weeks` later — DST-safe, unlike adding 7×24h. */
export function shiftDeadline(dueBy: Date, weeks: number): Date {
  return laDeadlineToUtc(`${addDays(pacificDateKey(dueBy), 7 * weeks)}T23:59`);
}

/** Wednesday 11:59 PM of the match's week — the cut-off for posting when the match will be played. A Sunday deadline belongs to the Mon–Sun run before it, so this is the Wednesday before. */
export function scheduleBy(dueBy: Date): Date {
  return laDeadlineToUtc(`${addDays(mondayOf(pacificDateKey(dueBy)), 2)}T23:59`);
}

/** 9 AM on the deadline day (Sunday, or a Thursday playoff deadline) — "report your score by tonight". */
export function reportReminderAt(dueBy: Date): Date {
  return laInputToUtc(`${pacificDateKey(dueBy)}T09:00`);
}

/** Unplayed matches are settled this long after the Sunday deadline (Monday ~10 AM), so a late-night report still counts. */
export const OVERDUE_GRACE_MS = 10 * 60 * 60 * 1000;

/**
 * "We're playing Thursday 7 PM" — must be before the score deadline. Posting
 * after Wednesday is still allowed (better late than never); the cut-off only
 * decides who gets the Thursday reminder and shows up on exec's list.
 */
export function postTimeProblem(m: { status: string; dueBy: Date | null }, when: Date): string | null {
  if (m.status !== "pending") return "This match already has a result.";
  if (!m.dueBy) return "This match has no deadline yet.";
  if (when > m.dueBy) return `That's after the deadline — it has to be played by ${laLabel(m.dueBy)}.`;
  return null;
}

function laLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/* ─── Season plan ────────────────────────────────────────────────────────── */

export type SeasonConfig = {
  seasonStartsOn: string;
  roundRobinWeeks: number;
  catchupWeeks: number;
  playoffTeams: number;
  finalOn: string;
};

export type PlayoffRound = { round: number; name: string; dueBy: Date; week: number };

export function roundName(teamsLeft: number): string {
  if (teamsLeft === 2) return "Final";
  if (teamsLeft === 4) return "Semifinals";
  if (teamsLeft === 8) return "Quarterfinals";
  return `Round of ${teamsLeft}`;
}

export function isPowerOfTwo(n: number): boolean {
  return n >= 2 && (n & (n - 1)) === 0;
}

/** Last deadline anything in the round robin can be pushed to (end of the catch-up weeks). */
export function regularSeasonEndsAt(c: SeasonConfig): Date {
  return weekDueBy(c.seasonStartsOn, c.roundRobinWeeks + c.catchupWeeks);
}

/**
 * Playoff deadlines. Each round before the final gets its own week, starting
 * the week after catch-up. A round that would land in the final's own week is
 * due two days before the final instead (Thursday for a Saturday final).
 * Throws if the rounds don't fit before the final — too many playoff teams.
 */
export function playoffRounds(c: SeasonConfig): PlayoffRound[] {
  if (!isPowerOfTwo(c.playoffTeams)) throw new Error("Playoff size has to be 2, 4, 8 or 16.");
  const total = Math.log2(c.playoffTeams);
  const firstWeek = c.roundRobinWeeks + c.catchupWeeks + 1;
  const finalDue = laDeadlineToUtc(`${c.finalOn}T23:59`);
  const lastPreFinalDue = laDeadlineToUtc(`${addDays(c.finalOn, -2)}T23:59`);
  const tooMany = new Error("Not enough weeks before the final for that many playoff teams.");

  const out: PlayoffRound[] = [];
  let previous = regularSeasonEndsAt(c);
  for (let r = 1; r < total; r++) {
    const week = firstWeek + r - 1;
    const sunday = weekDueBy(c.seasonStartsOn, week);
    const dueBy = sunday < lastPreFinalDue ? sunday : lastPreFinalDue;
    // Every round needs its own window after the one before it.
    if (dueBy <= previous) throw tooMany;
    out.push({ round: r, name: roundName(c.playoffTeams / 2 ** (r - 1)), dueBy, week });
    previous = dueBy;
  }
  if (finalDue <= previous) throw total === 1 ? new Error("The final is before the round robin ends.") : tooMany;
  out.push({ round: total, name: "Final", dueBy: finalDue, week: weekOf(c.seasonStartsOn, finalDue) });
  return out;
}

/** Biggest playoff that fits before the final, capped at about a third of the league. */
export function recommendedPlayoffTeams(teamCount: number, c: Omit<SeasonConfig, "playoffTeams">): number {
  let best = 2;
  for (const size of [4, 8, 16]) {
    if (size > Math.max(2, Math.ceil(teamCount / 3))) break;
    try {
      playoffRounds({ ...c, playoffTeams: size });
      best = size;
    } catch {
      break;
    }
  }
  return best;
}

/* ─── Bracket ────────────────────────────────────────────────────────────── */

/** Standard seeding so the top two can only meet in the final: 8 → 1v8, 4v5, 2v7, 3v6. */
export function bracketSeedPairs(size: number): [number, number][] {
  if (!isPowerOfTwo(size)) throw new Error("Bracket size has to be a power of two.");
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  const pairs: [number, number][] = [];
  for (let i = 0; i < order.length; i += 2) pairs.push([order[i], order[i + 1]]);
  return pairs;
}

/** Where a knockout winner goes: match `slot` of round r feeds match floor(slot/2) of round r+1, as team A (even) or B (odd). */
export function nextBracketSpot(slot: number): { slot: number; side: "A" | "B" } {
  return { slot: Math.floor(slot / 2), side: slot % 2 === 0 ? "A" : "B" };
}

/* ─── Match rules ────────────────────────────────────────────────────────── */

export type MatchState = {
  stage: "pool" | "knockout";
  status: "pending" | "reported" | "confirmed" | "disputed" | "forfeited";
  dueBy: Date | null;
  extendedForTeamId: string | null;
};

/** Skips (makeups) each team gets per season. Any skip past this is a forfeit. */
export const SKIP_LIMIT = 1;

export type SkipDecision =
  | { kind: "makeup" }
  | { kind: "forfeit"; reason: "skip_used" | "own_makeup" | "no_week_left" }
  | { kind: "blocked"; message: string };

/**
 * "We can't make it this week" (sick, out of town). What tapping it does for
 * this team on this match:
 *
 *   - their first skip of the season → the match becomes a makeup due a week later
 *   - any skip after that            → they forfeit it, right away
 *   - they can't make their own makeup → they forfeit it (the original rule)
 *   - no week left before playoffs   → they forfeit it
 *
 * Nothing at all for playoff matches, finished matches, after the deadline,
 * or a makeup the *other* team asked for (if it isn't played, that team
 * forfeits at the deadline — the team that can still play does nothing).
 */
export function skipDecision(
  m: MatchState,
  team: { teamId: string; skipsUsed: number },
  now: Date,
  seasonEnd: Date,
): SkipDecision {
  if (m.stage !== "pool") return { kind: "blocked", message: "Playoff matches can't be skipped — message exec if something's wrong." };
  if (m.status !== "pending") return { kind: "blocked", message: "This match already has a result." };
  if (!m.dueBy || now > m.dueBy) return { kind: "blocked", message: "This week's deadline has passed." };
  if (m.extendedForTeamId === team.teamId) return { kind: "forfeit", reason: "own_makeup" };
  if (m.extendedForTeamId) {
    return { kind: "blocked", message: "This is already the other team's makeup — if it isn't played by the deadline, they forfeit it." };
  }
  if (team.skipsUsed >= SKIP_LIMIT) return { kind: "forfeit", reason: "skip_used" };
  if (shiftDeadline(m.dueBy, 1) > seasonEnd) return { kind: "forfeit", reason: "no_week_left" };
  return { kind: "makeup" };
}

/** The one-line warning shown before a skip that forfeits. */
export const FORFEIT_REASON: Record<Extract<SkipDecision, { kind: "forfeit" }>["reason"], string> = {
  skip_used: "Your team already used its one skip this season, so skipping this match is a forfeit.",
  own_makeup: "This is your team's makeup — not playing it is a forfeit.",
  no_week_left: "There's no week left to make this up before playoffs, so skipping it is a forfeit.",
};

/**
 * What happens to a round-robin match nobody reported by the deadline.
 * Makeup not played (whichever team couldn't make it this time) → the team
 * that missed the original week forfeits.
 * Otherwise nobody told anyone anything → double forfeit (neither team gets
 * the win). Exec can always overrule either one.
 */
export function overdueOutcome(m: { teamAId: string; teamBId: string; extendedForTeamId: string | null }): {
  winnerTeamId: string | null;
} {
  if (m.extendedForTeamId === m.teamAId) return { winnerTeamId: m.teamBId };
  if (m.extendedForTeamId === m.teamBId) return { winnerTeamId: m.teamAId };
  return { winnerTeamId: null };
}

/* ─── Labels ─────────────────────────────────────────────────────────────── */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A season week, Sunday to Saturday (its match is due the Sunday after): "Oct 4 – 10" or "Nov 29 – Dec 5" */
export function weekRange(seasonStartsOn: string, week: number): string {
  const first = addDays(weekMonday(seasonStartsOn, week), -1);
  const last = addDays(first, 6);
  const [, m1, d1] = first.split("-").map(Number);
  const [, m2, d2] = last.split("-").map(Number);
  return m1 === m2 ? `${MONTHS[m1 - 1]} ${d1} – ${d2}` : `${MONTHS[m1 - 1]} ${d1} – ${MONTHS[m2 - 1]} ${d2}`;
}

/** What to call a match everywhere it's shown: "Week 3 · Oct 18 – 24", "Makeup (week 2)", "Semifinals". */
export function matchLabel(
  m: { stage: "pool" | "knockout"; round: number | null; extendedForTeamId: string | null },
  season: { seasonStartsOn: string; playoffTeams: number },
): string {
  if (m.stage === "knockout") return roundName(season.playoffTeams / 2 ** ((m.round ?? 1) - 1));
  if (m.extendedForTeamId) return `Makeup (week ${m.round})`;
  return `Week ${m.round} · ${weekRange(season.seasonStartsOn, m.round ?? 1)}`;
}
