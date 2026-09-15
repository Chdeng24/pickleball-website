import { cn } from "@/lib/utils";

/** Uppercase eyebrow label preceded by the brand's gold rule. */
export function Kicker({
  children,
  className,
  tone = "gold",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "gold" | "navy";
}) {
  return (
    <span className={cn("kicker inline-flex items-center gap-3", className)}>
      <span
        aria-hidden
        className={cn("h-px w-8", tone === "gold" ? "bg-gold-500" : "bg-navy-800")}
      />
      <span className={tone === "gold" ? "text-gold-500" : "text-navy-800"}>
        {children}
      </span>
    </span>
  );
}
