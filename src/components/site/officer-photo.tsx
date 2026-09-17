import Image from "next/image";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

/**
 * Headshot if one exists; otherwise an on-brand monogram so the board grid
 * never renders an empty box while photos are pending.
 */
export function OfficerPhoto({ name, photo }: { name: string; photo: string | null }) {
  if (photo) {
    return (
      <div className="relative aspect-square overflow-hidden">
        <Image src={photo} alt={name} fill sizes="(min-width: 1024px) 25vw, 50vw" className="object-cover" />
      </div>
    );
  }

  return (
    <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-navy-800">
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, var(--color-gold-500) 0, var(--color-gold-500) 1px, transparent 1px, transparent 12px)",
        }}
      />
      <span className="font-display text-4xl font-extrabold text-gold-500">{initials(name)}</span>
    </div>
  );
}
