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

  /** Domain members sign in from. Verified against the Google `hd` claim. */
  ALLOWED_EMAIL_DOMAIN: z.string().default("berkeley.edu"),

  /**
   * strict — only emails on the imported roster get approved; everyone else
   *          lands in `pending` and exec approves with one click.
   * open   — any verified @berkeley.edu is approved on first sign-in.
   */
  ROSTER_MODE: z.enum(["strict", "open"]).default("strict"),

  /** Non-Berkeley addresses allowed through the domain gate (club Gmail, exec). */
  ALLOWLIST_EMAILS: emailList,
  ADMIN_EMAILS: emailList,
  EXEC_EMAILS: emailList,
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
