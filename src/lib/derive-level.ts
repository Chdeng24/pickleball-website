/**
 * Pure logic for "skill level," which is never self-reported: it's the level
 * of the most recent Social Team practice a member is confirmed for or
 * attended. Free signal already collected via RSVPs, zero extra member effort.
 */

export type Level = "unknown" | "beginner" | "advanced";

export type LevelSignal = {
  /** The practice's level. Socials/fundraisers carry "unknown" and are ignored. */
  level: Level;
  /** Cancelled RSVPs don't count as a signal of anything. */
  status: "confirmed" | "waitlist" | "cancelled";
  startsAt: Date;
};

/**
 * Most-recent-practice-attended wins. Waitlist counts too — showing up on the
 * waitlist still tells you which level a member is aiming at; cancelled does not.
 */
export function deriveLevel(signals: LevelSignal[]): Level {
  const relevant = signals
    .filter((s) => s.status !== "cancelled" && s.level !== "unknown")
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());

  return relevant[0]?.level ?? "unknown";
}

/**
 * Never regress a known level back to unknown — e.g. a member who attended
 * once and later only shows up to a social (level "unknown") should keep
 * their last known practice level, not lose it.
 */
export function nextDerivedLevel(current: Level, signals: LevelSignal[]): Level {
  const computed = deriveLevel(signals);
  return computed === "unknown" ? current : computed;
}

/**
 * The level shown to people. Comp Team members are "Comp" regardless of
 * practices; everyone else is Social, with the practice-derived level once
 * they've been to one ("TBD" until then).
 */
export function skillLabel(u: { onCompetitiveTeam: boolean; derivedLevel: Level }): string {
  if (u.onCompetitiveTeam) return "Comp";
  if (u.derivedLevel === "unknown") return "Social · TBD";
  return `Social · ${u.derivedLevel === "beginner" ? "Beginner" : "Advanced"}`;
}
