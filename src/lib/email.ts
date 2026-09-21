import "server-only";
import { Resend } from "resend";
import { env } from "@/lib/env";
import { club } from "@/lib/content";
import { formatDeadline, formatEventWhen } from "@/lib/dates";

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

export async function sendPoolsAnnounced(
  to: Recipient,
  {
    tournamentName,
    teamName,
    pool,
    opponents,
    location,
    advancePerPool,
  }: {
    tournamentName: string;
    teamName: string;
    pool: string;
    opponents: (string | null)[];
    location: string | null;
    advancePerPool: number;
  },
): Promise<void> {
  const list = opponents.length
    ? `<ul style="margin:8px 0 0;padding-left:20px;">${opponents.map((o) => `<li>${esc(o) || "TBD"}</li>`).join("")}</ul>`
    : `<p style="margin:8px 0 0;color:#4b5566;">No other teams in your pool yet.</p>`;
  const html = layout(
    `${teamName} is in Pool ${pool}.`,
    `${hey(to)}
     <p><strong>${esc(teamName)}</strong> is in <strong>Pool ${esc(pool)}</strong> for the
     ${esc(tournamentName)}. You'll play everyone in your pool once, on your own schedule${
       location ? `, at ${esc(location)}` : ""
     }:</p>
     ${list}
     <p>The top ${advancePerPool} in each pool move up. Watch for a weekly reminder with whichever
     match is still unplayed — get them scheduled early.</p>
     ${button(`${club.url}/tournaments`, "See your pool")}`,
  );
  await sendEmail(to.email, `${tournamentName}: you're in Pool ${pool}`, html);
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

/** The Sunday nudge — reminds a team of their next unplayed match, with a friendly line about their last result if they have one. */
export async function sendWeeklyNudge(
  to: Recipient,
  {
    tournamentName,
    teamName,
    opponentName,
    lastResult,
  }: {
    tournamentName: string;
    teamName: string;
    opponentName: string | null;
    lastResult: { won: boolean; opponentName: string | null } | null;
  },
): Promise<void> {
  const friendlyLine = lastResult
    ? lastResult.won
      ? `<p>🎉 Nice win last time out against ${esc(lastResult.opponentName) || "your opponent"} — keep it rolling.</p>`
      : `<p>Tough one last time against ${esc(lastResult.opponentName) || "your opponent"} — get 'em this week.</p>`
    : "";
  const html = layout(
    `Your next ${tournamentName} match is still unplayed.`,
    `${hey(to)}
     <p><strong>${esc(teamName)}</strong> still has a match to play against
     <strong>${esc(opponentName) || "your remaining opponent"}</strong> in the ${esc(tournamentName)}.</p>
     <p>Get a time on the calendar this week, and report the score from the Tournaments tab
     once you're done.</p>
     ${friendlyLine}
     ${button(`${club.url}/tournaments`, "Open the Tournaments tab")}`,
  );
  await sendEmail(to.email, `Reminder: schedule your ${tournamentName} match`, html);
}
