import { Header } from "@/components/site/header";
import { Footer } from "@/components/site/footer";
import { getSessionUser } from "@/lib/session";

/**
 * Marketing chrome, also served to signed-in members on pages that don't
 * have a member-area equivalent yet (e.g. /tournaments). Kept out of the
 * root layout so /login, /pending, and every page under (member) — which has
 * its own MemberNav — don't inherit it.
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();

  return (
    <>
      <Header user={user} />
      <main className="flex-1">{children}</main>
      <Footer />
    </>
  );
}
