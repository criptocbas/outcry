"use client";

import { useState, useMemo } from "react";

const MIN_BID_INCREMENT_LAMPORTS = 100_000_000; // 0.1 SOL

interface AuctionState {
  currentBid: number;
  highestBidder: string | null;
  status: object;
  reservePrice: number;
}

interface BidPanelProps {
  auctionState: AuctionState;
  onBid: (amount: number) => void;
  onDeposit: (amount: number) => void;
  userDeposit: number | null;
  isLoading: boolean;
  isSeller?: boolean;
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
  onDeposit,
  userDeposit,
  isLoading,
  isSeller = false,
}: BidPanelProps) {
  const minBid = useMemo(() => {
    if (auctionState.currentBid > 0) {
      return auctionState.currentBid + MIN_BID_INCREMENT_LAMPORTS;
    }
    return auctionState.reservePrice;
  }, [auctionState.currentBid, auctionState.reservePrice]);

  const needsDeposit =
    userDeposit === null || userDeposit === 0 || userDeposit < minBid;

  const [bidInput, setBidInput] = useState<string>(
    formatSol(minBid)
  );
  const [depositInput, setDepositInput] = useState<string>(
    formatSol(minBid)
  );

  const handleBid = () => {
    const lamports = parseSolToLamports(bidInput);
    if (lamports >= minBid) {
      onBid(lamports);
    }
  };

  const handleDeposit = () => {
    const lamports = parseSolToLamports(depositInput);
    if (lamports > 0) {
      onDeposit(lamports);
    }
  };

  return (
    <div className="flex flex-col gap-6 rounded-lg border border-[#2A2A2A] bg-[#1A1A1A] p-6">
      {/* Current bid display */}
      <div className="flex flex-col items-center">
        <span
          className="mb-1 text-[10px] tracking-[0.25em] text-[#F5F0E8]/40 uppercase"
          style={{ fontFamily: "'DM Sans', sans-serif" }}
        >
          Current Bid
        </span>
        <div className="flex items-baseline gap-2">
          <span
            className="text-4xl font-bold tabular-nums text-[#C6A961]"
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {auctionState.currentBid > 0
              ? formatSol(auctionState.currentBid)
              : "0.00"}
          </span>
          <span
            className="text-sm font-medium text-[#C6A961]/50 uppercase"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
          >
            SOL
          </span>
        </div>
      </div>

      <div className="h-px bg-[#2A2A2A]" />

      {/* Seller sees a message instead of bid controls */}
      {isSeller ? (
        <p
          className="text-center text-xs text-[#F5F0E8]/40"
          style={{ fontFamily: "'DM Sans', sans-serif" }}
        >
          You are the seller — you cannot bid on your own auction.
        </p>
      ) : needsDeposit ? (
        /* Deposit flow */
        <div className="flex flex-col gap-3">
          <p
            className="text-center text-xs text-[#F5F0E8]/40"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
          >
            {userDeposit !== null && userDeposit > 0
              ? `Your deposit (${formatSol(userDeposit)} SOL) is below the minimum bid. Deposit more to bid.`
              : "Deposit SOL to start bidding on this auction."}
          </p>

          <div className="relative">
            <input
              type="number"
              step="0.01"
              min="0"
              value={depositInput}
              onChange={(e) => setDepositInput(e.target.value)}
              placeholder={formatSol(minBid)}
              className="w-full rounded-md border border-[#2A2A2A] bg-[#0D0D0D] px-4 py-3 pr-14 text-right text-lg tabular-nums text-[#F5F0E8] placeholder-[#F5F0E8]/20 outline-none transition-colors focus:border-[#C6A961]/60"
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontVariantNumeric: "tabular-nums",
              }}
            />
            <span
              className="absolute top-1/2 right-4 -translate-y-1/2 text-xs text-[#F5F0E8]/30 uppercase"
              style={{ fontFamily: "'DM Sans', sans-serif" }}
            >
              SOL
            </span>
          </div>

          <button
            onClick={handleDeposit}
            disabled={isLoading || parseSolToLamports(depositInput) <= 0}
            className="flex h-12 w-full items-center justify-center rounded-md bg-[#C6A961] text-sm font-semibold tracking-[0.15em] text-[#050505] uppercase transition-all duration-200 hover:bg-[#D4B872] disabled:cursor-not-allowed disabled:opacity-40"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
          >
            {isLoading ? <Spinner /> : "Deposit SOL"}
          </button>
        </div>
      ) : (
        /* Bid flow */
        <div className="flex flex-col gap-3">
          <div className="relative">
            <input
              type="number"
              step="0.01"
              min="0"
              value={bidInput}
              onChange={(e) => setBidInput(e.target.value)}
              className="w-full rounded-md border border-[#2A2A2A] bg-[#0D0D0D] px-4 py-3 pr-14 text-right text-lg tabular-nums text-[#F5F0E8] placeholder-[#F5F0E8]/20 outline-none transition-colors focus:border-[#C6A961]/60"
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontVariantNumeric: "tabular-nums",
              }}
            />
            <span
              className="absolute top-1/2 right-4 -translate-y-1/2 text-xs text-[#F5F0E8]/30 uppercase"
              style={{ fontFamily: "'DM Sans', sans-serif" }}
            >
              SOL
            </span>
          </div>

          <p
            className="text-center text-[11px] text-[#F5F0E8]/30"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
          >
            Minimum: {formatSol(minBid)} SOL
          </p>

          <button
            onClick={handleBid}
            disabled={isLoading || parseSolToLamports(bidInput) < minBid}
            className="flex h-12 w-full items-center justify-center rounded-md bg-[#C6A961] text-sm font-semibold tracking-[0.15em] text-[#050505] uppercase transition-all duration-200 hover:bg-[#D4B872] disabled:cursor-not-allowed disabled:opacity-40"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
          >
            {isLoading ? <Spinner /> : "Place Bid"}
          </button>
        </div>
      )}

      {/* Deposit balance */}
      {userDeposit !== null && userDeposit > 0 && (
        <p
          className="text-center text-[11px] text-[#F5F0E8]/25"
          style={{ fontFamily: "'DM Sans', sans-serif" }}
        >
          Your deposit: {formatSol(userDeposit)} SOL
        </p>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="h-5 w-5 animate-spin text-[#050505]"
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
