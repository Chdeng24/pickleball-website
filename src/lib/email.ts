import "server-only";
import { Resend } from "resend";
import { env } from "@/lib/env";
import { club } from "@/lib/content";
import { formatEventWhen } from "@/lib/dates";

type EventLike = { title: string; location: string; startsAt: Date; endsAt: Date };
type Recipient = { email: string; name: string | null };

let client: Resend | null = null;

/**
 * Low-level sender. Never throws — a dropped email must not roll back an
 * already-committed RSVP or promotion. Without RESEND_API_KEY (local dev,
 * or before the human sets it up), it logs instead of sending so the flow is
 * still visible without an account.
 */
async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const key = env().RESEND_API_KEY;
  if (!key) {
    console.log(`[email:dev] to=${to} subject="${subject}"\n${html}\n`);
    return;
  }
  try {
    client ??= new Resend(key);
    await client.emails.send({ from: env().EMAIL_FROM, to, subject, html });
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
            ${club.shortName}
          </p>
        </div>
        <div style="padding:28px 24px;color:#0b1220;font-size:15px;line-height:1.6;">
          ${bodyHtml}
        </div>
        <div style="padding:16px 24px;border-top:1px solid #eee;color:#9098a8;font-size:12px;">
          ${preheader}
        </div>
      </div>
    </div>`;
}

function eventDetailsHtml(event: EventLike): string {
  return `
    <div style="margin:16px 0;padding:14px 16px;background:#f6f7f9;border-left:4px solid #fdb515;">
      <p style="margin:0 0 4px;font-weight:700;">${event.title}</p>
      <p style="margin:0;color:#4b5566;">${formatEventWhen(event.startsAt, event.endsAt)}</p>
      <p style="margin:0;color:#4b5566;">${event.location}</p>
    </div>`;
}

export async function sendRsvpConfirmed(to: Recipient, event: EventLike): Promise<void> {
  const html = layout(
    `You're confirmed for ${event.title}.`,
    `<p>Hey ${to.name?.split(" ")[0] ?? "there"},</p>
     <p>You're confirmed for:</p>
     ${eventDetailsHtml(event)}
     <p>See you on the courts.</p>`,
  );
  await sendEmail(to.email, `Confirmed: ${event.title}`, html);
}

export async function sendWaitlistPromoted(to: Recipient, event: EventLike): Promise<void> {
  const html = layout(
    `A spot opened up for ${event.title}.`,
    `<p>Hey ${to.name?.split(" ")[0] ?? "there"},</p>
     <p>Good news — a spot opened up and you're off the waitlist:</p>
     ${eventDetailsHtml(event)}
     <p>You're confirmed. See you there.</p>`,
  );
  await sendEmail(to.email, `You're in: ${event.title}`, html);
}

export async function sendEventCancelled(to: Recipient, event: EventLike): Promise<void> {
  const html = layout(
    `${event.title} has been cancelled.`,
    `<p>Hey ${to.name?.split(" ")[0] ?? "there"},</p>
     <p>This event has been cancelled:</p>
     ${eventDetailsHtml(event)}
     <p>Sorry for the short notice — check the site for updates.</p>`,
  );
  await sendEmail(to.email, `Cancelled: ${event.title}`, html);
}
