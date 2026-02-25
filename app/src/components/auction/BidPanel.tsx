"use client";

import { useState, useMemo, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { formatSOL } from "@/lib/utils";
import Spinner from "@/components/ui/Spinner";

interface AuctionState {
  currentBid: number;
  highestBidder: string | null;
  status: object;
  reservePrice: number;
  minBidIncrement: number;
}

interface BidPanelProps {
  /** HTML id for scroll targeting (e.g. mobile sticky bar) */
  id?: string;
  auctionState: AuctionState;
  /** Single action: handles deposit (if needed) + bid in one flow */
  onBid: (bidLamports: number) => void;
  isLoading: boolean;
  isSeller?: boolean;
  userDeposit: number | null;
  /** Progress label shown during multi-step flow */
  progressLabel?: string | null;
  /** When true, shows "Deposit" instead of "Place Bid" and relaxes min bid validation */
  depositOnly?: boolean;
}

function parseSolToLamports(sol: string): number {
  const parsed = parseFloat(sol);
  if (isNaN(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 1_000_000_000);
}

export default function BidPanel({
  id,
  auctionState,
  onBid,
  isLoading,
  isSeller = false,
  userDeposit,
  progressLabel,
  depositOnly = false,
}: BidPanelProps) {
  const { connected } = useWallet();

  const minBid = useMemo(() => {
    if (auctionState.currentBid > 0) {
      return auctionState.currentBid + auctionState.minBidIncrement;
    }
    return auctionState.reservePrice;
  }, [auctionState.currentBid, auctionState.reservePrice, auctionState.minBidIncrement]);

  const [bidInput, setBidInput] = useState<string>(formatSOL(minBid));
  const [userEdited, setUserEdited] = useState(false);

  // Update suggested bid when minBid changes (e.g. someone else bids),
  // but only if user hasn't manually typed a custom amount
  useEffect(() => {
    if (!userEdited) {
      setBidInput(formatSOL(minBid));
    }
  }, [minBid, userEdited]);

  const bidLamports = parseSolToLamports(bidInput);
  const depositNeeded =
    userDeposit !== null ? Math.max(0, bidLamports - userDeposit) : bidLamports;
  const hasEnoughDeposit = depositNeeded === 0;

  const handleBid = () => {
    if (depositOnly ? bidLamports > 0 : bidLamports >= minBid) {
      onBid(bidLamports);
    }
  };

  // Quick bid buttons: min bid, +0.1, +0.5
  const quickBids = useMemo(() => {
    const bids = [
      { label: `${formatSOL(minBid)}`, value: minBid },
    ];
    const plus01 = minBid + 100_000_000;
    const plus05 = minBid + 500_000_000;
    bids.push({ label: `${formatSOL(plus01)}`, value: plus01 });
    bids.push({ label: `${formatSOL(plus05)}`, value: plus05 });
    return bids;
  }, [minBid]);

  return (
    <div id={id} className="flex flex-col gap-4 rounded-lg border border-charcoal-light bg-charcoal p-5">
      {/* Seller message */}
      {isSeller ? (
        <p className="text-center text-xs text-cream/40">
          You are the seller — you cannot bid on your own auction.
        </p>
      ) : !connected ? (
        <p className="text-center text-xs text-cream/40 py-2">
          Connect your wallet to place a bid.
        </p>
      ) : (
        <>
          {/* Quick bid buttons */}
          <div className="flex gap-2">
            {quickBids.map((qb) => (
              <button
                key={qb.value}
                onClick={() => { setBidInput(formatSOL(qb.value)); setUserEdited(false); }}
                className={`flex-1 rounded-md border py-2 text-xs font-medium tabular-nums transition-all ${
                  bidLamports === qb.value
                    ? "border-gold/50 bg-gold/10 text-gold"
                    : "border-charcoal-light text-cream/40 hover:border-cream/20 hover:text-cream/60"
                }`}
              >
                {qb.label}
              </button>
            ))}
          </div>

          {/* Custom bid input */}
          <div className="relative">
            <input
              type="number"
              step="0.01"
              min="0"
              value={bidInput}
              onChange={(e) => { setBidInput(e.target.value); setUserEdited(true); }}
              className="w-full rounded-md border border-charcoal-light bg-jet px-4 py-3 pr-14 text-right text-lg tabular-nums text-cream placeholder-cream/20 outline-none transition-colors focus:border-gold/60"
            />
            <span className="absolute top-1/2 right-4 -translate-y-1/2 text-xs text-cream/30 uppercase">
              SOL
            </span>
          </div>

          {/* Info line: what will happen */}
          <div className="space-y-1">
            {depositOnly ? (
              <p className="text-center text-[11px] text-cream/30">
                Reserve price: {formatSOL(minBid)} SOL
              </p>
            ) : (
              <>
                <p className="text-center text-[11px] text-cream/30">
                  Minimum bid: {formatSOL(minBid)} SOL
                </p>
                {!hasEnoughDeposit && bidLamports >= minBid && (
                  <p className="text-center text-[11px] text-gold/60">
                    Will deposit {formatSOL(depositNeeded)} SOL first, then place bid
                  </p>
                )}
              </>
            )}
          </div>

          {/* Bid button */}
          <button
            onClick={handleBid}
            disabled={isLoading || (depositOnly ? bidLamports <= 0 : bidLamports < minBid)}
            className="flex h-12 w-full items-center justify-center rounded-md bg-gold text-sm font-semibold tracking-[0.15em] text-jet uppercase transition-all duration-200 hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isLoading ? (
              <div className="flex items-center gap-2">
                <Spinner />
                {progressLabel && (
                  <span className="text-xs font-medium normal-case tracking-normal">
                    {progressLabel}
                  </span>
                )}
              </div>
            ) : depositOnly ? (
              "Deposit SOL"
            ) : (
              "Place Bid"
            )}
          </button>

          {/* Deposit balance */}
          {userDeposit !== null && userDeposit > 0 && (
            <p className="text-center text-[11px] text-cream/25">
              Deposit balance: {formatSOL(userDeposit)} SOL (refundable)
            </p>
          )}
        </>
      )}
    </div>
  );
}
