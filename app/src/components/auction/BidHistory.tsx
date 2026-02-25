"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useTapestryProfile } from "@/hooks/useTapestryProfile";
import { truncateAddress, formatSOL } from "@/lib/utils";

interface Bid {
  bidder: string;
  amount: number;
  timestamp: number;
}

interface BidHistoryProps {
  bids: Bid[];
}

function relativeTime(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = Math.max(0, Math.floor(now - timestamp));

  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function BidderName({ wallet }: { wallet: string }) {
  const { profile } = useTapestryProfile(wallet);
  const display = profile?.profile.username || truncateAddress(wallet);

  return (
    <a
      href={`/profile/${wallet}`}
      className="text-xs text-cream/70 transition-colors hover:text-gold"
    >
      {display}
    </a>
  );
}

export default function BidHistory({ bids }: BidHistoryProps) {
  const sorted = [...bids].sort((a, b) => b.timestamp - a.timestamp);

  return (
    <div className="flex flex-col">
      {/* Header */}
      <h3 className="mb-3 text-[10px] tracking-[0.25em] text-cream/40 uppercase">
        Bid History
      </h3>

      {/* Scrollable list */}
      <div className="max-h-64 overflow-y-auto pr-1">
        {sorted.length === 0 ? (
          <p className="py-8 text-center font-serif text-sm italic text-cream/30">
            No bids yet &mdash; be the first
          </p>
        ) : (
          <AnimatePresence initial={false}>
            {sorted.map((bid) => (
              <motion.div
                key={`${bid.bidder}-${bid.amount}`}
                initial={{ opacity: 0, x: -24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="flex items-center justify-between border-b border-charcoal-light/60 py-2.5"
              >
                {/* Left: name + time */}
                <div className="flex flex-col">
                  <BidderName wallet={bid.bidder} />
                  <span className="text-[10px] text-cream/25">
                    {relativeTime(bid.timestamp)}
                  </span>
                </div>

                {/* Right: amount */}
                <div className="flex items-baseline gap-1">
                  <span className="text-sm font-semibold tabular-nums text-gold">
                    {formatSOL(bid.amount)}
                  </span>
                  <span className="text-[10px] text-gold/50 uppercase">
                    SOL
                  </span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

    </div>
  );
}
