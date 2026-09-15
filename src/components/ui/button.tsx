import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Sharp-cornered, uppercase athletic button. No border radius by design —
 * the brand leans on hard edges and gold rules.
 */
const button = cva(
  "inline-flex items-center justify-center gap-2 font-display text-sm font-bold uppercase tracking-[0.12em] transition-all duration-200 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        gold: "bg-gold-500 text-navy-900 hover:bg-gold-400 hover:-translate-y-0.5 active:translate-y-0",
        navy: "bg-navy-800 text-white hover:bg-navy-700 hover:-translate-y-0.5 active:translate-y-0",
        outline:
          "border-2 border-white/35 text-white hover:border-gold-500 hover:text-gold-500 backdrop-blur-sm",
        outlineDark:
          "border-2 border-navy-800/25 text-navy-800 hover:border-navy-800 hover:bg-navy-800 hover:text-white",
      },
      size: {
        sm: "h-10 px-5",
        md: "h-12 px-7",
        lg: "h-14 px-9 text-base",
      },
    },
    defaultVariants: { variant: "gold", size: "md" },
  },
);

type Props = VariantProps<typeof button> & {
  href?: string;
  className?: string;
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({ href, variant, size, className, children, ...rest }: Props) {
  const classes = cn(button({ variant, size }), className);
  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }
  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  );
}
