/**
 * Social Team League draw: pool assignment + round-robin match generation.
 * Pure and deterministic (given the same rng) so exec can regenerate a draft
 * draw and see exactly what changed — no DB, no side effects.
 */

export type DrawLevel = "unknown" | "beginner" | "advanced";
export type DrawTeam = { id: string; level: DrawLevel };

const LEVEL_RANK: Record<DrawLevel, number> = { advanced: 2, beginner: 1, unknown: 0 };

export function poolLabel(index: number): string {
  // A..Z, then AA, AB... — plenty for any realistic team count.
  let n = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

/** Fisher–Yates, seeded via an injectable rng so draws are testable and, for the real one, replayable if needed. */
function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Splits teams into pools of at most `poolSize` (default 8), sized as evenly
 * as possible — e.g. 15 teams at poolSize 8 makes one pool of 8 and one of 7,
 * never a pool of 8 and a leftover pool of 1. Seeded by level (advanced
 * first), randomized within the same level, then dealt round-robin across
 * pools so skill is spread evenly rather than stacked in pool A.
 */
export function assignPools(
  teams: DrawTeam[],
  poolSize = 8,
  rng: () => number = Math.random,
): Map<string, string[]> {
  const pools = new Map<string, string[]>();
  if (teams.length === 0) return pools;

  const poolCount = Math.max(1, Math.ceil(teams.length / poolSize));
  for (let i = 0; i < poolCount; i++) pools.set(poolLabel(i), []);

  const seeded = shuffle(teams, rng).sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);

  seeded.forEach((team, i) => {
    pools.get(poolLabel(i % poolCount))!.push(team.id);
  });

  return pools;
}

/** Every unique pair within a pool — C(n,2) matches, so an 8-team pool gets 7 games per team. */
export function generateRoundRobinMatches(teamIds: string[]): { teamAId: string; teamBId: string }[] {
  const games: { teamAId: string; teamBId: string }[] = [];
  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) {
      games.push({ teamAId: teamIds[i], teamBId: teamIds[j] });
    }
  }
  return games;
}
