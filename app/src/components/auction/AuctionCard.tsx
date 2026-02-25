"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import AuctionStatus from "./AuctionStatus";
import NftImage from "./NftImage";
import { formatTimeRemaining, formatSOL } from "@/lib/utils";

interface AuctionStatus_t {
  created?: Record<string, never>;
  active?: Record<string, never>;
  ended?: Record<string, never>;
  settled?: Record<string, never>;
  cancelled?: Record<string, never>;
}

interface Auction {
  publicKey: string;
  seller: string;
  nftMint: string;
  currentBid: number;
  endTime: number;
  bidCount: number;
  status: AuctionStatus_t;
  reservePrice: number;
}

interface AuctionCardProps {
  auction: Auction;
}

function getStatusKey(status: AuctionStatus_t): string {
  if (status.active !== undefined) return "active";
  if (status.ended !== undefined) return "ended";
  if (status.settled !== undefined) return "settled";
  if (status.cancelled !== undefined) return "cancelled";
  return "created";
}

export default function AuctionCard({ auction }: AuctionCardProps) {
  const statusKey = getStatusKey(auction.status);

  const displayBid =
    auction.currentBid > 0 ? auction.currentBid : auction.reservePrice;
  const bidLabel = auction.currentBid > 0 ? "Current Bid" : "Reserve";

  return (
    <Link href={`/auction/${auction.publicKey}`}>
      <motion.div
        whileHover={{ scale: 1.02 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="group cursor-pointer overflow-hidden rounded-lg border border-[#2A2A2A] bg-[#1A1A1A] transition-all duration-300 hover:border-[#C6A961]/60 hover:shadow-[0_0_20px_rgba(198,169,97,0.15)]"
      >
        {/* NFT Artwork */}
        <div className="relative aspect-square w-full">
          <NftImage
            mintAddress={auction.nftMint}
            className="absolute inset-0 h-full w-full"
            showName
          />
          {/* Status badge overlay */}
          <div className="absolute top-3 left-3 z-10">
            <AuctionStatus status={auction.status} />
          </div>
        </div>

        {/* Info section */}
        <div className="px-4 pt-3 pb-4">
          {/* Bid amount */}
          <div className="mb-2 flex items-baseline justify-between">
            <div className="flex flex-col">
              <span
                className="text-[9px] tracking-[0.2em] text-[#F5F0E8]/30 uppercase"
                style={{ fontFamily: "'DM Sans', sans-serif" }}
              >
                {bidLabel}
              </span>
              <div className="flex items-baseline gap-1.5">
                <span
                  className="text-xl font-bold tabular-nums text-[#C6A961]"
                  style={{
                    fontFamily: "'DM Sans', sans-serif",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatSOL(displayBid)}
                </span>
                <span
                  className="text-[10px] font-medium text-[#C6A961]/50 uppercase"
                  style={{ fontFamily: "'DM Sans', sans-serif" }}
                >
                  SOL
                </span>
              </div>
            </div>

            {/* Bid count */}
            <div className="flex flex-col items-end">
              <span
                className="text-[9px] tracking-[0.2em] text-[#F5F0E8]/30 uppercase"
                style={{ fontFamily: "'DM Sans', sans-serif" }}
              >
                Bids
              </span>
              <span
                className="text-sm tabular-nums text-[#F5F0E8]/60"
                style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {auction.bidCount}
              </span>
            </div>
          </div>

          {/* Footer: timer */}
          {statusKey === "active" && (
            <div className="border-t border-[#2A2A2A] pt-2">
              <TimeRemaining endTime={auction.endTime} />
            </div>
          )}
        </div>
      </motion.div>
    </Link>
  );
}

function TimeRemaining({ endTime }: { endTime: number }) {
  const [display, setDisplay] = useState(() => formatTimeRemaining(endTime));

  useEffect(() => {
    const id = setInterval(() => setDisplay(formatTimeRemaining(endTime)), 1000);
    return () => clearInterval(id);
  }, [endTime]);

  const now = Math.floor(Date.now() / 1000);
  const remaining = endTime - now;
  const isUrgent = remaining > 0 && remaining < 300;

  return (
    <div className="flex items-center gap-1.5">
      <svg
        className={`h-3 w-3 ${isUrgent ? "text-red-400" : "text-cream/30"}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
      </svg>
      <span
        className={`text-xs tabular-nums ${
          isUrgent ? "font-semibold text-red-400" : "text-cream/50"
        }`}
      >
        {display}
      </span>
    </div>
  );
}
