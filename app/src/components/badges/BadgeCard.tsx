"use client";

import { motion } from "framer-motion";
import type { Badge } from "@/lib/badges";

// ---------------------------------------------------------------------------
// Badge visuals per type
// ---------------------------------------------------------------------------

const BADGE_STYLES: Record<
  string,
  { bg: string; border: string; icon: string; label: string }
> = {
  victor: {
    bg: "from-amber-900/40 to-yellow-900/20",
    border: "border-gold/50",
    icon: "\u2655", // chess queen
    label: "Victor",
  },
  contender: {
    bg: "from-indigo-900/40 to-violet-900/20",
    border: "border-indigo-400/40",
    icon: "\u2694", // crossed swords
    label: "Contender",
  },
  present: {
    bg: "from-emerald-900/30 to-teal-900/20",
    border: "border-emerald-400/30",
    icon: "\u2606", // star outline
    label: "Present",
  },
  unknown: {
    bg: "from-zinc-800/40 to-zinc-900/20",
    border: "border-zinc-600/30",
    icon: "?",
    label: "Badge",
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function BadgeCard({ badge }: { badge: Badge }) {
  const style = BADGE_STYLES[badge.badgeType] ?? BADGE_STYLES.unknown;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={`group relative overflow-hidden rounded-xl border ${style.border} bg-gradient-to-br ${style.bg} p-4 transition-all duration-300 hover:scale-[1.02]`}
    >
      {/* Badge icon */}
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-xl">
          {style.icon}
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] font-medium tracking-[0.15em] text-cream/40 uppercase">
            {style.label}
          </span>
          <span className="text-xs font-medium text-cream/70 truncate max-w-full">
            {badge.auctionName}
          </span>
        </div>
      </div>

      {/* Date attribute */}
      {badge.attributes.map((attr) =>
        attr.trait_type === "Date" ? (
          <span
            key={attr.trait_type}
            className="text-[10px] text-cream/25"
          >
            {attr.value}
          </span>
        ) : null
      )}

      {/* Winning bid (victor only) */}
      {badge.badgeType === "victor" &&
        badge.attributes
          .filter((a) => a.trait_type === "Winning Bid")
          .map((a) => (
            <span
              key={a.trait_type}
              className="mt-1 block text-xs font-semibold tabular-nums text-gold/70"
            >
              {a.value}
            </span>
          ))}

      {/* Subtle shine overlay on hover */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.02] to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
    </motion.div>
  );
}
