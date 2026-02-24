"use client";

import { motion } from "framer-motion";
import BadgeCard from "@/components/badges/BadgeCard";
import type { Badge } from "@/lib/badges";

interface BadgeGridProps {
  badges: Badge[];
  loading: boolean;
}

export default function BadgeGrid({ badges, loading }: BadgeGridProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-28 animate-shimmer rounded-xl border border-charcoal-light/30"
          />
        ))}
      </div>
    );
  }

  if (badges.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10">
        <span className="text-2xl opacity-20">&#9734;</span>
        <p className="text-xs text-cream/20">No badges earned yet</p>
        <p className="max-w-xs text-center text-[10px] text-cream/15">
          Participate in auctions to earn Present, Contender, and Victor badges.
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: 0.08 } },
      }}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      {badges.map((badge) => (
        <BadgeCard key={badge.id} badge={badge} />
      ))}
    </motion.div>
  );
}
