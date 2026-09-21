import { z } from "zod";

/** Comma-separated email list -> normalized array. Tolerates spaces and blanks. */
const emailList = z
  .string()
  .optional()
  .default("")
  .transform((s) =>
    s
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(1),
  AUTH_GOOGLE_ID: z.string().min(1),
  AUTH_GOOGLE_SECRET: z.string().min(1),

  /**
   * strict — auto-approved only if BOTH on the roster AND on ALLOWED_EMAIL_DOMAIN;
   *          everyone else (including an off-domain roster entry — a sponsor,
   *          a coach) lands in `pending` for exec to approve with one click.
   * open   — any verified account is approved on first sign-in, roster or not.
   */
  ROSTER_MODE: z.enum(["strict", "domain", "open"]).default("strict"),

  /** Domain the roster auto-approve bypass checks. Not a sign-in restriction — see canSignIn(). */
  ALLOWED_EMAIL_DOMAIN: z.string().default("berkeley.edu"),

  ADMIN_EMAILS: emailList,
  EXEC_EMAILS: emailList,

  // Optional in dev — unset means emails log to the console instead of sending.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Pickleball at Berkeley <onboarding@resend.dev>"),

  /** Bearer token the event-reminder cron endpoint checks. Unset = endpoint always refuses. */
  CRON_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/**
 * Parsed lazily and never at module scope — `next build` runs without secrets,
 * and a top-level throw would break the static build of public pages.
 */
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(
        `Invalid environment:\n${z.prettifyError(parsed.error)}\n\nSee .env.example.`,
      );
    }
    cached = parsed.data;
  }
  return cached;
}
