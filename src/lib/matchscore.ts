/**
 * Best-of-3 doubles score validation. Pure — no DB — so the rules are
 * readable and testable on their own.
 */

export type GameScore = [number, number]; // [teamA, teamB]

export type ScoreCheckResult =
  | { ok: true; winner: "A" | "B" }
  | { ok: false; error: string };

/** Standard club rules: games to 11, win by 2. */
export function checkMatchScore(
  games: GameScore[],
  { gameTo = 11, winBy = 2 }: { gameTo?: number; winBy?: number } = {},
): ScoreCheckResult {
  if (games.length !== 2 && games.length !== 3) {
    return { ok: false, error: "A match is 2 or 3 games." };
  }

  let aWins = 0;
  let bWins = 0;

  for (const [a, b] of games) {
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) {
      return { ok: false, error: "Scores must be non-negative whole numbers." };
    }
    if (a === b) {
      return { ok: false, error: "A game can't end in a tie." };
    }
    const high = Math.max(a, b);
    const low = Math.min(a, b);
    if (high < gameTo) {
      return { ok: false, error: `Someone has to reach at least ${gameTo}.` };
    }
    if (high - low < winBy) {
      return { ok: false, error: `Games must be won by at least ${winBy}.` };
    }
    if (a > b) aWins++;
    else bWins++;
  }

  if (games.length === 2 && aWins !== 2 && bWins !== 2) {
    return { ok: false, error: "Two games in and no one has won 2 — you need a third." };
  }
  if (games.length === 3) {
    if (aWins === bWins) {
      return { ok: false, error: "That's a 1-1-1 split, which isn't a valid best-of-3 result." };
    }
    // The match stops the moment either side reaches 2 wins — a 3rd game only
    // makes sense after the first two split 1-1.
    const [g1, g2] = games;
    const firstTwoSplit = (g1[0] > g1[1]) !== (g2[0] > g2[1]);
    if (!firstTwoSplit) {
      return {
        ok: false,
        error: "One side already won the first two games — there wouldn't be a third.",
      };
    }
  }

  return { ok: true, winner: aWins > bWins ? "A" : "B" };
}
