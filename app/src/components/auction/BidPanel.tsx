"use client";

import { useState, useMemo, useEffect } from "react";

const MIN_BID_INCREMENT_LAMPORTS = 100_000_000; // 0.1 SOL

interface AuctionState {
  currentBid: number;
  highestBidder: string | null;
  status: object;
  reservePrice: number;
}

interface BidPanelProps {
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

function formatSol(lamports: number): string {
  return (lamports / 1_000_000_000).toFixed(2);
}

function parseSolToLamports(sol: string): number {
  const parsed = parseFloat(sol);
  if (isNaN(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 1_000_000_000);
}

export default function BidPanel({
  auctionState,
  onBid,
  isLoading,
  isSeller = false,
  userDeposit,
  progressLabel,
  depositOnly = false,
}: BidPanelProps) {
  const minBid = useMemo(() => {
    if (auctionState.currentBid > 0) {
      return auctionState.currentBid + MIN_BID_INCREMENT_LAMPORTS;
    }
    return auctionState.reservePrice;
  }, [auctionState.currentBid, auctionState.reservePrice]);

  const [bidInput, setBidInput] = useState<string>(formatSol(minBid));

  // Update suggested bid when minBid changes (e.g. someone else bids)
  useEffect(() => {
    setBidInput(formatSol(minBid));
  }, [minBid]);

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
      { label: `${formatSol(minBid)}`, value: minBid },
    ];
    const plus01 = minBid + 100_000_000;
    const plus05 = minBid + 500_000_000;
    bids.push({ label: `${formatSol(plus01)}`, value: plus01 });
    bids.push({ label: `${formatSol(plus05)}`, value: plus05 });
    return bids;
  }, [minBid]);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-charcoal-light bg-charcoal p-5">
      {/* Seller message */}
      {isSeller ? (
        <p className="text-center text-xs text-cream/40">
          You are the seller — you cannot bid on your own auction.
        </p>
      ) : (
        <>
          {/* Quick bid buttons */}
          <div className="flex gap-2">
            {quickBids.map((qb) => (
              <button
                key={qb.value}
                onClick={() => setBidInput(formatSol(qb.value))}
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
              onChange={(e) => setBidInput(e.target.value)}
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
                Reserve price: {formatSol(minBid)} SOL
              </p>
            ) : (
              <>
                <p className="text-center text-[11px] text-cream/30">
                  Minimum bid: {formatSol(minBid)} SOL
                </p>
                {!hasEnoughDeposit && bidLamports >= minBid && (
                  <p className="text-center text-[11px] text-gold/60">
                    Will deposit {formatSol(depositNeeded)} SOL first, then place bid
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
              Deposit balance: {formatSol(userDeposit)} SOL (refundable)
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="h-5 w-5 animate-spin text-jet"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
