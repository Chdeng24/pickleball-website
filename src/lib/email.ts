import "server-only";
import { Resend } from "resend";
import { env } from "@/lib/env";
import { club, leagueInfo } from "@/lib/content";
import { formatDeadline, formatEventWhen } from "@/lib/dates";
import { scheduleBy } from "@/lib/schedule";

type EventLike = { title: string; location: string; startsAt: Date; endsAt: Date };
type Recipient = { email: string; name: string | null };

let client: Resend | null = null;

/** Every interpolated value is user- or exec-typed (names, team names) — escape it so it can't inject markup. */
function esc(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function hey(to: Recipient): string {
  return `<p>Hey ${esc(to.name?.split(" ")[0]) || "there"},</p>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0;"><a href="${href}" style="display:inline-block;background:#0a2a66;color:#ffffff;padding:12px 20px;font-weight:700;text-decoration:none;text-transform:uppercase;letter-spacing:.04em;font-size:13px;">${esc(label)}</a></p>`;
}

/**
 * Low-level sender. Never throws — a dropped email must not roll back an
 * already-committed RSVP, promotion, or registration. Without RESEND_API_KEY
 * (local dev) it logs instead of sending.
 *
 * Resend returns failures as `{ error }` rather than throwing, so the result
 * is checked explicitly — otherwise a rejected send would vanish without a trace.
 */
async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const key = env().RESEND_API_KEY;
  if (!key) {
    console.log(`[email:dev] to=${to} subject="${subject}"\n${html}\n`);
    return;
  }
  try {
    client ??= new Resend(key);
    const { error } = await client.emails.send({ from: env().EMAIL_FROM, to, subject, html });
    if (error) console.error(`Resend rejected "${subject}" to ${to}: ${error.name} — ${error.message}`);
  } catch (err) {
    console.error(`Failed to send "${subject}" to ${to}`, err);
  }
}

type Message = { to: string; subject: string; html: string };

/**
 * Sends many at once through Resend's batch endpoint (100 per call) — the
 * weekly league emails go to ~80 players at the same moment, which would trip
 * the per-second rate limit one request at a time. Never throws.
 */
export async function sendMany(messages: Message[]): Promise<void> {
  if (messages.length === 0) return;
  const key = env().RESEND_API_KEY;
  if (!key) {
    for (const m of messages) console.log(`[email:dev] to=${m.to} subject="${m.subject}"\n${m.html}\n`);
    return;
  }
  client ??= new Resend(key);
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100).map((m) => ({ from: env().EMAIL_FROM, ...m }));
    try {
      const { error } = await client.batch.send(chunk);
      if (error) console.error(`Resend rejected a batch of ${chunk.length}: ${error.name} — ${error.message}`);
    } catch (err) {
      console.error(`Failed to send a batch of ${chunk.length}`, err);
    }
  }
}

/** Shared shell — navy header, gold rule, matches the site's brand. */
function layout(preheader: string, bodyHtml: string): string {
  return `
    <div style="background:#f6f7f9;padding:32px 16px;font-family:-apple-system,Helvetica,Arial,sans-serif;">
      <div style="max-width:480px;margin:0 auto;background:#ffffff;border:2px solid #0a2a66;">
        <div style="background:#0a2a66;padding:20px 24px;border-bottom:4px solid #fdb515;">
          <p style="margin:0;color:#ffffff;font-weight:800;letter-spacing:.04em;text-transform:uppercase;font-size:14px;">
            ${esc(club.shortName)}
          </p>
        </div>
        <div style="padding:28px 24px;color:#0b1220;font-size:15px;line-height:1.6;">
          ${bodyHtml}
        </div>
        <div style="padding:16px 24px;border-top:1px solid #eee;color:#9098a8;font-size:12px;">
          ${esc(preheader)}
        </div>
      </div>
    </div>`;
}

function eventDetailsHtml(event: EventLike): string {
  return `
    <div style="margin:16px 0;padding:14px 16px;background:#f6f7f9;border-left:4px solid #fdb515;">
      <p style="margin:0 0 4px;font-weight:700;">${esc(event.title)}</p>
      <p style="margin:0;color:#4b5566;">${esc(formatEventWhen(event.startsAt, event.endsAt))}</p>
      <p style="margin:0;color:#4b5566;">${esc(event.location)}</p>
    </div>`;
}

export async function sendRsvpConfirmed(to: Recipient, event: EventLike): Promise<void> {
  const html = layout(
    `You're confirmed for ${event.title}.`,
    `${hey(to)}
     <p>You're confirmed for:</p>
     ${eventDetailsHtml(event)}
     <p>See you on the courts.</p>`,
  );
  await sendEmail(to.email, `Confirmed: ${event.title}`, html);
}

export async function sendWaitlistPromoted(to: Recipient, event: EventLike): Promise<void> {
  const html = layout(
    `A spot opened up for ${event.title}.`,
    `${hey(to)}
     <p>Good news — a spot opened up and you're off the waitlist:</p>
     ${eventDetailsHtml(event)}
     <p>You're confirmed. See you there.</p>`,
  );
  await sendEmail(to.email, `You're in: ${event.title}`, html);
}

export async function sendEventReminder(to: Recipient, event: EventLike): Promise<void> {
  const html = layout(
    `${event.title} is coming up.`,
    `${hey(to)}
     <p>Reminder — you're confirmed for this tomorrow:</p>
     ${eventDetailsHtml(event)}
     <p>See you there.</p>`,
  );
  await sendEmail(to.email, `Reminder: ${event.title} is tomorrow`, html);
}

export async function sendEventCancelled(to: Recipient, event: EventLike): Promise<void> {
  const html = layout(
    `${event.title} has been cancelled.`,
    `${hey(to)}
     <p>This event has been cancelled:</p>
     ${eventDetailsHtml(event)}
     <p>Sorry for the short notice — check the site for updates.</p>`,
  );
  await sendEmail(to.email, `Cancelled: ${event.title}`, html);
}

/* ─── Pickleball League ──────────────────────────────────────────────────── */

export async function sendPartnerInvite(
  to: Recipient,
  {
    captainName,
    tournamentName,
    teamName,
    location,
    registrationClosesAt,
  }: {
    captainName: string | null;
    tournamentName: string;
    teamName: string;
    location: string | null;
    registrationClosesAt: Date | null;
  },
): Promise<void> {
  const where = location ? ` Matches are at ${esc(location)}.` : "";
  const html = layout(
    `${captainName ?? "Someone"} wants you as their partner.`,
    `${hey(to)}
     <p><strong>${esc(captainName) || "A teammate"}</strong> invited you to play in the
     <strong>${esc(tournamentName)}</strong> as <strong>${esc(teamName)}</strong>.${where}</p>
     ${button(`${club.url}/tournaments`, "Accept or decline")}
     <p style="color:#4b5566;">Your spot is held until you answer${
       registrationClosesAt ? ` — registration closes ${esc(formatDeadline(registrationClosesAt))}` : ""
     }.</p>`,
  );
  await sendEmail(to.email, `Team invite: ${tournamentName}`, html);
}

export async function sendScoreReported(
  to: Recipient,
  { tournamentName, reporterName, summary }: { tournamentName: string; reporterName: string | null; summary: string },
): Promise<void> {
  const html = layout(
    `A score was reported for your match.`,
    `${hey(to)}
     <p><strong>${esc(reporterName) || "Someone"}</strong> reported this result in the
     ${esc(tournamentName)}:</p>
     <div style="margin:16px 0;padding:14px 16px;background:#f6f7f9;border-left:4px solid #fdb515;">
       <p style="margin:0;font-weight:700;">${esc(summary)}</p>
     </div>
     <p>It auto-confirms soon unless someone disputes it from the Tournaments tab.</p>
     ${button(`${club.url}/tournaments`, "Review the score")}`,
  );
  await sendEmail(to.email, `Score reported: ${tournamentName}`, html);
}

/* ─── Pickleball League season ───────────────────────────────────────────── */

export type MatchLine = {
  /** "Week 3 · Oct 19–25", "Makeup (week 2)", "Quarterfinals" */
  label: string;
  dueBy: Date;
  /** Null = a bye (open slot). */
  opponent: { name: string; players: Recipient[] } | null;
};

function opponentHtml(o: NonNullable<MatchLine["opponent"]>): string {
  const players = o.players
    .map((p) => `${esc(p.name) || esc(p.email)} (<a href="mailto:${esc(p.email)}" style="color:#0a2a66;">${esc(p.email)}</a>)`)
    .join(" &amp; ");
  return `<strong>${esc(o.name)}</strong>${players ? `<br><span style="color:#4b5566;font-size:13px;">${players}</span>` : ""}`;
}

function matchBox(m: MatchLine): string {
  return `
    <div style="margin:12px 0;padding:14px 16px;background:#f6f7f9;border-left:4px solid #fdb515;">
      <p style="margin:0 0 4px;font-size:12px;font-weight:700;text-transform:uppercase;color:#4b5566;">${esc(m.label)}</p>
      <p style="margin:0;">${m.opponent ? `vs ${opponentHtml(m.opponent)}` : "<strong>Bye</strong> — no match this week."}</p>
      ${m.opponent ? `<p style="margin:6px 0 0;color:#4b5566;font-size:13px;">Post your time by ${esc(formatDeadline(scheduleBy(m.dueBy)))} · report by ${esc(formatDeadline(m.dueBy))}</p>` : ""}
    </div>`;
}

const bookingLine = `<p style="color:#4b5566;font-size:13px;">${esc(leagueInfo.courtBookingNote)} <a href="${leagueInfo.courtBookingUrl}" style="color:#0a2a66;">Book a court</a>.</p>`;

/** The season is published: your whole round-robin schedule, week by week. */
export function scheduleAnnouncedEmail(
  to: Recipient,
  d: { tournamentName: string; teamName: string; weeks: MatchLine[]; playoffTeams: number; updated?: boolean },
): Message {
  const rows = d.weeks
    .map(
      (w) =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:13px;color:#4b5566;white-space:nowrap;">${esc(w.label)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:14px;">${w.opponent ? esc(w.opponent.name) : "<em>Bye</em>"}</td></tr>`,
    )
    .join("");
  return {
    to: to.email,
    subject: d.updated ? `UPDATED ${d.tournamentName} schedule — replaces the earlier email` : `${d.tournamentName}: your schedule is out`,
    html: layout(
      `${d.teamName}'s ${d.tournamentName} schedule.`,
      `${hey(to)}
       <p>${
         d.updated
           ? `The ${esc(d.tournamentName)} schedule was <strong>updated</strong> — this replaces the schedule you got earlier.`
           : `The ${esc(d.tournamentName)} schedule is out.`
       } <strong>${esc(d.teamName)}</strong> plays one match a week:</p>
       <table style="width:100%;border-collapse:collapse;margin:12px 0;">${rows}</table>
       <p>${esc(leagueInfo.weekRule)} Your opponents' contact info is on the site — message them on Slack to set a time.</p>
       <p>The top ${d.playoffTeams} make the playoffs.</p>
       ${bookingLine}
       ${button(`${club.url}/tournaments`, "See the full schedule")}`,
    ),
  };
}

/** Thursday: the Wednesday cut-off passed and nobody posted when this week's match is. */
export function noTimePostedEmail(to: Recipient, d: { tournamentName: string; teamName: string; matches: MatchLine[] }): Message {
  return {
    to: to.email,
    subject: `${d.tournamentName}: post your match time`,
    html: layout(
      `No match time posted for ${d.teamName} yet.`,
      `${hey(to)}
       <p>The Wednesday cut-off passed and nobody has posted when <strong>${esc(d.teamName)}</strong> is playing:</p>
       ${d.matches.map(matchBox).join("")}
       <p>Lock in a time with your opponents on Slack, post it on the site, and play and report by Sunday 11:59 PM.
       Sick or out of town? Let your opponents know and tap <strong>Can't make it this week</strong> — it becomes a makeup next week.</p>
       <p style="color:#4b5566;font-size:13px;">${esc(leagueInfo.noShowRule)}</p>
       ${button(`${club.url}/tournaments`, "Post a time")}`,
    ),
  };
}

/** Deadline morning (Sunday): the score is due tonight. */
export function reportTonightEmail(to: Recipient, d: { tournamentName: string; teamName: string; matches: MatchLine[] }): Message {
  return {
    to: to.email,
    subject: `${d.tournamentName}: report your score by tonight`,
    html: layout(
      `${d.teamName}'s score is due tonight.`,
      `${hey(to)}
       <p>No score yet for <strong>${esc(d.teamName)}</strong> — it's due <strong>tonight at 11:59 PM</strong>:</p>
       ${d.matches.map(matchBox).join("")}
       <p>Once you've played, any one of the four players can report it on the site.</p>
       <p style="color:#4b5566;font-size:13px;">${esc(leagueInfo.noShowRule)}</p>
       ${button(`${club.url}/tournaments`, "Report the score")}`,
    ),
  };
}

/** Someone in the match said their team can't make it this week — the match moved to a makeup week. */
export function outOfTownEmail(
  to: Recipient,
  d: { tournamentName: string; requestingTeam: string; otherTeam: string; newDueBy: Date; toOpponent: boolean },
): Message {
  return {
    to: to.email,
    subject: `${d.tournamentName}: match moved to a makeup`,
    html: layout(
      `${d.requestingTeam} vs ${d.otherTeam} is now a makeup.`,
      `${hey(to)}
       <p><strong>${esc(d.requestingTeam)}</strong> can't make it this week, so their match against
       <strong>${esc(d.otherTeam)}</strong> is now a makeup, due <strong>${esc(formatDeadline(d.newDueBy))}</strong>.</p>
       <p>That week you'll have this makeup plus your regular match — post a time for it by Wednesday like any other.</p>
       ${
         d.toOpponent
           ? `<p>This doesn't use your team's skip, and your team isn't penalized: if the makeup doesn't happen, ${esc(d.requestingTeam)} forfeits it and <strong>you get the win</strong>.</p>`
           : `<p>That was your team's one skip for the season. If the makeup doesn't happen, ${esc(d.requestingTeam)} forfeits it, and any skip after this is a forfeit.</p>`
       }
       ${button(`${club.url}/tournaments`, "See your schedule")}`,
    ),
  };
}

/** A team skipped a match it couldn't skip for free — the other team wins by forfeit. */
export function skipForfeitEmail(to: Recipient, d: { tournamentName: string; forfeitingTeam: string; otherTeam: string }): Message {
  return {
    to: to.email,
    subject: `${d.tournamentName}: ${d.forfeitingTeam} forfeited`,
    html: layout(
      `${d.forfeitingTeam} forfeited their match against ${d.otherTeam}.`,
      `${hey(to)}
       <p><strong>${esc(d.forfeitingTeam)}</strong> can't play their match against <strong>${esc(d.otherTeam)}</strong>,
       and they've already used their one skip this season (or it was their makeup), so it's a forfeit —
       <strong>${esc(d.otherTeam)}</strong> gets the win. No need to schedule this one.</p>
       ${button(`${club.url}/tournaments`, "See the standings")}`,
    ),
  };
}

/** A late team took over an open slot — their schedule from this week on. */
export async function sendLateTeamSchedule(
  to: Recipient,
  d: { tournamentName: string; teamName: string; weeks: MatchLine[]; playoffTeams: number },
): Promise<void> {
  const m = scheduleAnnouncedEmail(to, d);
  await sendEmail(m.to, `${d.tournamentName}: you're in — here's your schedule`, m.html);
}
