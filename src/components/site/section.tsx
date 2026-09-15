import { cn } from "@/lib/utils";
import { Container } from "@/components/ui/container";
import { Kicker } from "@/components/ui/kicker";

export function Section({
  kicker,
  title,
  lead,
  children,
  tone = "light",
  className,
  id,
}: {
  kicker?: string;
  title?: React.ReactNode;
  lead?: string;
  children?: React.ReactNode;
  tone?: "light" | "navy" | "chalk";
  className?: string;
  id?: string;
}) {
  const tones = {
    light: "bg-white text-ink",
    chalk: "bg-chalk text-ink",
    navy: "bg-navy-900 text-white",
  };

  return (
    <section id={id} className={cn("py-20 sm:py-28", tones[tone], className)}>
      <Container>
        {(kicker || title) && (
          <div className="max-w-3xl">
            {kicker && <Kicker tone={tone === "navy" ? "gold" : "navy"}>{kicker}</Kicker>}
            {title && (
              <h2
                className={cn(
                  "mt-5 font-display text-display font-extrabold uppercase",
                  tone === "navy" ? "text-white" : "text-navy-900",
                )}
              >
                {title}
              </h2>
            )}
            {lead && (
              <p
                className={cn(
                  "mt-6 text-lg leading-relaxed",
                  tone === "navy" ? "text-white/70" : "text-ink/65",
                )}
              >
                {lead}
              </p>
            )}
          </div>
        )}
        {children}
      </Container>
    </section>
  );
}
