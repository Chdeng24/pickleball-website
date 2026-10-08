import type { ReactNode } from "react";
import { formatDeadline } from "@/lib/dates";
import { resultText, scoreFor, type LeagueView, type ViewMatch } from "@/lib/league-view";
import { weekRange } from "@/lib/schedule";
import { cn } from "@/lib/utils";
import { TeamName } from "./team-hover";

/** The one league table. Gold rule under the last playoff spot. */
export function StandingsTable({ view, playoffTeams, highlight }: { view: LeagueView; playoffTeams: number; highlight?: string }) {
  if (view.standings.length === 0) return <p className="text-sm text-ink/50">No teams on the schedule yet.</p>;
  return (
    <div className="overflow-x-auto border-2 border-navy-900/10 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-navy-900/10 text-left text-[11px] font-bold uppercase tracking-wide text-ink/45">
            <th className="p-3">#</th>
            <th className="p-3">Team</th>
            <th className="p-3 text-right">W-L</th>
            <th className="hidden p-3 text-right sm:table-cell">Games</th>
            <th className="hidden p-3 text-right sm:table-cell">Points</th>
          </tr>
        </thead>
        <tbody>
          {view.standings.map((s, i) => (
            <tr
              key={s.teamId}
              className={cn(
                "border-b border-navy-900/5 last:border-b-0",
                i === playoffTeams - 1 && view.standings.length > playoffTeams && "border-b-4 border-b-gold-500",
                s.teamId === highlight && "bg-gold-500/10",
              )}
            >
              <td className="p-3 text-ink/50">{s.rank}</td>
              <td className="p-3">
                <TeamName teamId={s.teamId} name={view.name(s.teamId)} className={s.teamId === highlight ? "font-bold text-navy-900" : "text-navy-900"} />
                {s.tiebreak === "unresolved" && i === playoffTeams - 1 && (
                  <span className="ml-2 bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">Tie — exec decides</span>
                )}
              </td>
              <td className="p-3 text-right font-semibold text-navy-900">
                {s.wins}-{s.losses}
              </td>
              <td className="hidden p-3 text-right text-ink/55 sm:table-cell">
                {s.gameDiff >= 0 ? "+" : ""}
                {s.gameDiff}
              </td>
              <td className="hidden p-3 text-right text-ink/55 sm:table-cell">
                {s.pointDiff >= 0 ? "+" : ""}
                {s.pointDiff}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-navy-900/5 p-3 text-xs text-ink/45">
        Top {playoffTeams} make the playoffs. Ties: head-to-head, then game difference, then point difference.
      </p>
    </div>
  );
}

function MatchRow({
  view,
  m,
  highlight,
  actions,
}: {
  view: LeagueView;
  m: ViewMatch;
  highlight?: string;
  actions?: (m: ViewMatch) => ReactNode;
}) {
  const bye = view.isBye(m);
  const side = (id: string | null) => (
    <TeamName
      teamId={id}
      name={view.name(id)}
      className={cn(id === highlight ? "font-bold text-navy-900" : "text-navy-900", id === m.winnerTeamId && "underline decoration-gold-500 decoration-2 decoration-solid underline-offset-4")}
    />
  );
  return (
    <li className={cn("p-3 text-sm", (m.teamAId === highlight || m.teamBId === highlight) && "bg-gold-500/10")}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span>
          {bye ? (
            <>
              {side(view.byId.get(m.teamAId ?? "")?.isPlaceholder ? m.teamBId : m.teamAId)} <span className="text-ink/45">— bye</span>
            </>
          ) : (
            <>
              {side(m.teamAId)} <span className="text-ink/40">vs</span> {side(m.teamBId)}
            </>
          )}
        </span>
        {!bye && (
          <span className="text-xs text-ink/50">
            {m.status === "confirmed"
              ? scoreFor(view.reportByMatch.get(m.id), m)
              : m.status === "pending" && m.scheduledAt
                ? `Playing ${formatDeadline(m.scheduledAt)}${m.scheduledNote ? ` · ${m.scheduledNote}` : ""}`
                : resultText(view, m)}
            {m.extendedForTeamId && m.status === "pending" && m.dueBy ? ` · makeup due ${formatDeadline(m.dueBy)}` : ""}
          </span>
        )}
      </div>
      {actions && !bye && <div className="mt-2">{actions(m)}</div>}
    </li>
  );
}

/** One week of the round robin. */
export function WeekSchedule({
  view,
  week,
  highlight,
  actions,
}: {
  view: LeagueView;
  week: number;
  highlight?: string;
  actions?: (m: ViewMatch) => ReactNode;
}) {
  const games = view.pool.filter((m) => m.round === week);
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-ink/50">
        Week {week}
        {view.season ? ` · ${weekRange(view.season.seasonStartsOn, week)}` : ""}
      </p>
      <ul className="mt-1 divide-y divide-navy-900/5 border-2 border-navy-900/10 bg-white">
        {games.map((m) => (
          <MatchRow key={m.id} view={view} m={m} highlight={highlight} actions={actions} />
        ))}
      </ul>
    </div>
  );
}

/** Single elimination, one column per round. Seeds shown next to team names. */
export function Bracket({ view, highlight, actions }: { view: LeagueView; highlight?: string; actions?: (m: ViewMatch) => ReactNode }) {
  const rounds = [...new Set(view.knockout.map((m) => m.round ?? 0))].sort((a, b) => a - b);
  if (rounds.length === 0) return null;
  const seed = (id: string | null) => (id ? view.byId.get(id)?.seed : null);
  return (
    <div className="grid gap-4 lg:grid-flow-col lg:auto-cols-fr">
      {rounds.map((r) => {
        const games = view.knockout.filter((m) => m.round === r);
        return (
          <div key={r}>
            <p className="text-xs font-bold uppercase tracking-wide text-ink/50">
              {view.label(games[0])}
              {games[0].dueBy ? ` · by ${formatDeadline(games[0].dueBy)}` : ""}
            </p>
            <ul className="mt-1 space-y-2">
              {games.map((m) => (
                <li key={m.id} className="border-2 border-navy-900/10 bg-white">
                  {[m.teamAId, m.teamBId].map((id, i) => (
                    <div
                      key={i}
                      className={cn(
                        "flex items-center justify-between gap-2 border-b border-navy-900/5 px-3 py-2 text-sm last:border-b-0",
                        id && id === highlight && "bg-gold-500/10",
                        id && id === m.winnerTeamId && "font-bold",
                      )}
                    >
                      <span className={id ? "text-navy-900" : "text-ink/40"}>
                        {seed(id) ? <span className="mr-1.5 text-xs text-ink/40">{seed(id)}</span> : null}
                        <TeamName teamId={id} name={view.name(id)} />
                      </span>
                      {id && id === m.winnerTeamId && <span className="bg-gold-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-navy-900">Win</span>}
                    </div>
                  ))}
                  {m.status !== "pending" && <p className="px-3 pb-2 text-xs text-ink/50">{resultText(view, m)}</p>}
                  {actions && m.teamAId && m.teamBId && <div className="px-3 pb-3">{actions(m)}</div>}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
