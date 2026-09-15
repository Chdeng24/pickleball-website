import { Header } from "@/components/site/header";
import { Footer } from "@/components/site/footer";

/**
 * Marketing chrome for signed-out visitors: transparent-over-hero header +
 * footer. Kept out of the root layout so /login, /pending, and every page
 * under (member) — which has its own MemberNav — don't inherit it.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </>
  );
}
