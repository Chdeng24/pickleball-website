import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { canSignIn, initialAccess, normalizeEmail, type Role, type MemberStatus } from "@/lib/access";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      status: MemberStatus;
      derivedLevel: "unknown" | "beginner" | "advanced";
      duprUrl: string | null;
      onCompetitiveTeam: boolean;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

/**
 * Config is a function so environment parsing happens per-request rather than at
 * module load — `next build` prerenders the public pages without secrets present.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const e = env();

  return {
    // Required outside Vercel — Auth.js only auto-trusts a small list of known
    // hosts, and rejects everything else as a security precaution. Cloudflare
    // Workers isn't on that list, so without this every sign-in attempt fails
    // with a generic "Configuration" error.
    trustHost: true,
    adapter: DrizzleAdapter(db(), {
      usersTable: schema.users,
      accountsTable: schema.accounts,
      sessionsTable: schema.sessions,
      verificationTokensTable: schema.verificationTokens,
    }),
    session: { strategy: "database" },
    pages: { signIn: "/login", error: "/login" },

    providers: [
      Google({
        clientId: e.AUTH_GOOGLE_ID,
        clientSecret: e.AUTH_GOOGLE_SECRET,
        authorization: {
          params: {
            // No `hd` param here on purpose — it doesn't just hint Google's
            // account picker, it can restrict it to that domain, which would
            // block the non-Berkeley emails (sponsors, coaches, alumni) this
            // club explicitly wants to let request access.
            prompt: "select_account",
          },
        },
      }),
    ],

    callbacks: {
      async signIn({ profile }) {
        return canSignIn({
          email: profile?.email,
          emailVerified: Boolean(profile?.email_verified),
        });
      },

      async session({ session, user }) {
        // Read role/status fresh from the row so a promotion or block takes
        // effect on the next request, not at the next login.
        const row = await db().query.users.findFirst({
          where: eq(schema.users.id, user.id),
          columns: { role: true, status: true, derivedLevel: true, duprUrl: true, onCompetitiveTeam: true },
        });

        session.user.id = user.id;
        session.user.role = row?.role ?? "member";
        session.user.status = row?.status ?? "pending";
        session.user.derivedLevel = row?.derivedLevel ?? "unknown";
        session.user.duprUrl = row?.duprUrl ?? null;
        session.user.onCompetitiveTeam = row?.onCompetitiveTeam ?? false;
        return session;
      },
    },

    events: {
      /** Apply roster + role rules exactly once, when the row is first created. */
      async createUser({ user }) {
        if (!user.email || !user.id) return;
        const email = normalizeEmail(user.email);

        const roster = await db().query.rosterEmails.findFirst({
          where: eq(schema.rosterEmails.email, email),
        });

        const access = initialAccess({
          email,
          onRoster: Boolean(roster),
          rosterMode: e.ROSTER_MODE,
          allowedDomain: e.ALLOWED_EMAIL_DOMAIN,
          adminEmails: e.ADMIN_EMAILS,
          execEmails: e.EXEC_EMAILS,
        });

        await db()
          .update(schema.users)
          .set({
            role: access.role,
            status: access.status,
            onRoster: access.onRoster,
            // Prefer the roster's name — it's what exec typed, not a Google display name.
            name: roster?.name ?? user.name,
          })
          .where(eq(schema.users.id, user.id));
      },
    },
  };
});
