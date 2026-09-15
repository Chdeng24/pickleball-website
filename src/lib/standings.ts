/**
 * Round-robin pool standings.
 *
 * With 8-team pools and only 3 spots into the knockout, ties are not an edge
 * case — they are the normal outcome. This is pure and deterministic so the
 * table shown to members always matches what the draw actually does.
 */

export type PoolMatch = {
  teamAId: string;
  teamBId: string;
  winnerTeamId: string;
  /** Best of 3, e.g. [[11,7],[9,11],[11,5]] — always [teamA, teamB]. */
  games: number[][];
};

export type Standing = {
  teamId: string;
  played: number;
  wins: number;
  losses: number;
  gamesWon: number;
  gamesLost: number;
  gameDiff: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  rank: number;
  /** Which rule separated this team from the one below it. */
  tiebreak?: "head-to-head" | "mini-league" | "game-diff" | "point-diff" | "unresolved";
};

function blank(teamId: string): Standing {
  return {
    teamId,
    played: 0,
    wins: 0,
    losses: 0,
    gamesWon: 0,
    gamesLost: 0,
    gameDiff: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    pointDiff: 0,
    rank: 0,
  };
}

/** Accumulate raw totals. Only confirmed matches should be passed in. */
function tally(teamIds: string[], matches: PoolMatch[]): Map<string, Standing> {
  const table = new Map(teamIds.map((id) => [id, blank(id)]));

  for (const m of matches) {
    const a = table.get(m.teamAId);
    const b = table.get(m.teamBId);
    if (!a || !b) continue; // match references a team outside this pool

    a.played++;
    b.played++;
    if (m.winnerTeamId === m.teamAId) {
      a.wins++;
      b.losses++;
    } else {
      b.wins++;
      a.losses++;
    }

    for (const [pa, pb] of m.games) {
      a.pointsFor += pa;
      a.pointsAgainst += pb;
      b.pointsFor += pb;
      b.pointsAgainst += pa;
      if (pa > pb) {
        a.gamesWon++;
        b.gamesLost++;
      } else if (pb > pa) {
        b.gamesWon++;
        a.gamesLost++;
      }
    }
  }

  for (const s of table.values()) {
    s.gameDiff = s.gamesWon - s.gamesLost;
    s.pointDiff = s.pointsFor - s.pointsAgainst;
  }
  return table;
}

/**
 * Order a set of teams that are level on match wins.
 *
 * Two teams tied -> head-to-head result decides it.
 * Three or more  -> mini-league: wins counted only among the tied teams. If that
 *                   is still level, fall through to game then point differential.
 */
function breakTie(
  tied: Standing[],
  matches: PoolMatch[],
): Standing[] {
  if (tied.length === 1) return tied;

  const ids = new Set(tied.map((t) => t.teamId));
  const between = matches.filter((m) => ids.has(m.teamAId) && ids.has(m.teamBId));

  if (tied.length === 2) {
    const [x, y] = tied;
    const h2h = between.find(
      (m) =>
        (m.teamAId === x.teamId && m.teamBId === y.teamId) ||
        (m.teamAId === y.teamId && m.teamBId === x.teamId),
    );
    if (h2h) {
      const winner = h2h.winnerTeamId === x.teamId ? x : y;
      const loser = winner === x ? y : x;
      winner.tiebreak = "head-to-head";
      loser.tiebreak = "head-to-head";
      return [winner, loser];
    }
  } else {
    // Mini-league across the tied group only.
    const mini = tally([...ids], between);
    const byMini = [...tied].sort(
      (p, q) => (mini.get(q.teamId)?.wins ?? 0) - (mini.get(p.teamId)?.wins ?? 0),
    );
    const distinct = new Set(byMini.map((t) => mini.get(t.teamId)?.wins ?? 0));
    if (distinct.size > 1) {
      // Recurse so sub-groups still level get the remaining rules applied.
      const out: Standing[] = [];
      let i = 0;
      while (i < byMini.length) {
        const w = mini.get(byMini[i].teamId)?.wins ?? 0;
        const group = byMini.filter((t) => (mini.get(t.teamId)?.wins ?? 0) === w);
        group.forEach((g) => (g.tiebreak = "mini-league"));
        out.push(...breakTie(group, matches));
        i += group.length;
      }
      return out;
    }
  }

  // Still level: overall game differential, then point differential.
  const sorted = [...tied].sort((p, q) => q.gameDiff - p.gameDiff || q.pointDiff - p.pointDiff);
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    cur.tiebreak =
      cur.gameDiff !== next.gameDiff
        ? "game-diff"
        : cur.pointDiff !== next.pointDiff
          ? "point-diff"
          : "unresolved"; // genuinely identical — exec decides
  }
  return sorted;
}

/**
 * Final pool table, best first. A `tiebreak` of "unresolved" on a team at the
 * cut line means exec has to make the call — surface it, never hide it.
 */
export function computeStandings(teamIds: string[], matches: PoolMatch[]): Standing[] {
  const table = tally(teamIds, matches);
  const all = [...table.values()];

  const byWins = [...all].sort((p, q) => q.wins - p.wins);
  const ordered: Standing[] = [];

  let i = 0;
  while (i < byWins.length) {
    const group = byWins.filter((t) => t.wins === byWins[i].wins);
    ordered.push(...breakTie(group, matches));
    i += group.length;
  }

  ordered.forEach((s, idx) => (s.rank = idx + 1));
  return ordered;
}
