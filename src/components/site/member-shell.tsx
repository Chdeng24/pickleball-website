import { MemberNav } from "./member-nav";
import { Container } from "@/components/ui/container";
import type { SessionUser } from "@/lib/session";

/**
 * The member-area chrome (MemberNav + content container), factored out so
 * pages that exist in both a public and signed-in-member form (e.g.
 * /tournaments) can render this shell without living under the (member)
 * route group — which would require a second, URL-colliding page.
 */
export function MemberShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  return (
    <div className="min-h-[100svh] bg-chalk">
      <MemberNav user={user} />
      <Container className="py-8 pb-24 sm:py-12 sm:pb-16">{children}</Container>
    </div>
  );
}
