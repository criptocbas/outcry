"use client";

import { useState, useMemo, useEffect, useRef } from "react";
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
  /** Session key bidding props */
  sessionActive?: boolean;
  onEnableSession?: (depositAmount: number) => void;
  sessionActivating?: boolean;
  sessionActivationProgress?: string | null;
  /** Top up deposit during active session (one wallet popup) */
  onTopUpDeposit?: (amount: number) => void;
}

// Cap at 1B lamports (~1 SOL on devnet is plenty) to prevent overflow
// when converting to BN for program calls. Number.MAX_SAFE_INTEGER is
// ~9_007_199 SOL — we use a much lower practical ceiling.
const MAX_BID_LAMPORTS = 1_000_000 * 1_000_000_000; // 1 000 000 SOL

function parseSolToLamports(sol: string): number {
  const parsed = parseFloat(sol);
  if (isNaN(parsed) || parsed < 0) return 0;
  const lamports = Math.round(parsed * 1_000_000_000);
  return Math.min(lamports, MAX_BID_LAMPORTS);
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
  sessionActive = false,
  onEnableSession,
  sessionActivating = false,
  sessionActivationProgress,
  onTopUpDeposit,
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
  const [showConfirm, setShowConfirm] = useState(false);
  const submittingRef = useRef(false);

  // Session enable flow: show deposit input before activating
  const [showSessionSetup, setShowSessionSetup] = useState(false);
  const [sessionDepositInput, setSessionDepositInput] = useState<string>("");

  // Update suggested bid when minBid changes (e.g. someone else bids),
  // but only if user hasn't manually typed a custom amount
  useEffect(() => {
    if (!userEdited) {
      setBidInput(formatSOL(minBid));
    }
  }, [minBid, userEdited]);

  // Reset confirm dialog when loading finishes (bid submitted or cancelled)
  useEffect(() => {
    if (!isLoading) {
      submittingRef.current = false;
    }
  }, [isLoading]);

  const bidLamports = parseSolToLamports(bidInput);
  const depositNeeded =
    userDeposit !== null ? Math.max(0, bidLamports - userDeposit) : bidLamports;
  const hasEnoughDeposit = depositNeeded === 0;

  // In session mode, block bids that exceed deposit
  const sessionDepositInsufficient = sessionActive && !hasEnoughDeposit;

  const handleBidClick = () => {
    if (depositOnly ? bidLamports > 0 : bidLamports >= minBid) {
      if (depositOnly) {
        // Deposits don't need confirmation
        onBid(bidLamports);
      } else if (sessionActive) {
        // Session mode: block if deposit insufficient
        if (sessionDepositInsufficient) return;
        // Skip confirmation for speed
        if (submittingRef.current) return;
        submittingRef.current = true;
        onBid(bidLamports);
      } else {
        setShowConfirm(true);
      }
    }
  };

  const handleConfirmBid = () => {
    if (submittingRef.current) return; // debounce guard
    submittingRef.current = true;
    setShowConfirm(false);
    onBid(bidLamports);
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

  // Default session deposit: 3x the current minimum bid (reasonable budget)
  const defaultSessionDeposit = useMemo(() => {
    const budget = minBid * 3;
    const alreadyDeposited = userDeposit ?? 0;
    return Math.max(0, budget - alreadyDeposited);
  }, [minBid, userDeposit]);

  // Initialize session deposit input when setup is shown
  useEffect(() => {
    if (showSessionSetup) {
      setSessionDepositInput(formatSOL(defaultSessionDeposit));
    }
  }, [showSessionSetup, defaultSessionDeposit]);

  return (
    <div id={id} className="flex flex-col gap-4 rounded-lg border border-charcoal-light bg-charcoal p-5" role="region" aria-label="Bid controls">
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
          {/* Session active indicator (above bid controls) */}
          {sessionActive && (
            <div className="flex items-center justify-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span className="text-xs font-medium text-emerald-400">Quick Bidding Active</span>
              <span className="text-[10px] text-cream/20">&mdash; no popups</span>
            </div>
          )}

          {/* Quick bid buttons */}
          <div className="flex gap-2">
            {quickBids.map((qb) => (
              <button
                key={qb.value}
                aria-label={`Bid ${qb.label} SOL`}
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
              onKeyDown={(e) => { if (e.key === "Enter") handleBidClick(); }}
              aria-label="Bid amount in SOL"
              className="w-full rounded-md border border-charcoal-light bg-jet px-4 py-3 pr-14 text-right text-lg tabular-nums text-cream placeholder-cream/20 outline-none transition-colors focus:border-gold/60 focus:ring-1 focus:ring-gold/30"
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
                {userDeposit !== null && (
                  <p className="text-center text-[11px] text-cream/25">
                    Your deposit: {formatSOL(userDeposit)} SOL
                    {!hasEnoughDeposit && bidLamports >= minBid && !sessionActive && (
                      <span className="text-gold/60">
                        {" "}&mdash; needs {formatSOL(depositNeeded)} more
                      </span>
                    )}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Session mode: deposit insufficient warning + top up */}
          {sessionActive && !hasEnoughDeposit && bidLamports >= minBid && (
            <div className="flex flex-col gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-center text-[11px] text-amber-400/80">
                Your deposit ({formatSOL(userDeposit ?? 0)} SOL) doesn&apos;t cover this bid.
                Top up to continue quick bidding.
              </p>
              {onTopUpDeposit && (
                <button
                  onClick={() => onTopUpDeposit(depositNeeded)}
                  disabled={isLoading}
                  className="flex h-9 w-full items-center justify-center rounded-md border border-amber-500/40 text-xs font-medium text-amber-400 transition-all hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isLoading ? (
                    <div className="flex items-center gap-2">
                      <Spinner />
                      <span className="text-xs normal-case tracking-normal">{progressLabel ?? "Depositing..."}</span>
                    </div>
                  ) : (
                    `Top Up ${formatSOL(depositNeeded)} SOL`
                  )}
                </button>
              )}
            </div>
          )}

          {/* Confirmation dialog (skipped in session mode) */}
          {showConfirm && !sessionActive ? (
            <div className="flex flex-col gap-2 rounded-md border border-gold/30 bg-gold/5 p-3">
              <p className="text-center text-xs text-cream/60">
                Bid {formatSOL(bidLamports)} SOL?
                {!hasEnoughDeposit && (
                  <span className="block text-gold/60 mt-0.5">
                    Will deposit {formatSOL(depositNeeded)} SOL first
                  </span>
                )}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="flex h-10 flex-1 items-center justify-center rounded-md border border-charcoal-light text-xs font-medium text-cream/50 transition-all hover:border-cream/30"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmBid}
                  className="flex h-10 flex-1 items-center justify-center rounded-md bg-gold text-xs font-semibold tracking-[0.1em] text-jet uppercase transition-all hover:bg-gold-light"
                >
                  Confirm
                </button>
              </div>
            </div>
          ) : (
            /* Bid button */
            <button
              onClick={handleBidClick}
              disabled={isLoading || sessionActivating || sessionDepositInsufficient || (depositOnly ? bidLamports <= 0 : bidLamports < minBid)}
              className={`flex h-12 w-full items-center justify-center rounded-md text-sm font-semibold tracking-[0.15em] text-jet uppercase transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40 ${
                sessionActive
                  ? "bg-emerald-400 hover:bg-emerald-300"
                  : "bg-gold hover:bg-gold-light"
              }`}
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
              ) : sessionActive ? (
                "Quick Bid"
              ) : (
                "Place Bid"
              )}
            </button>
          )}

          {/* Session key toggle (only for active auctions, not deposit-only, not already active) */}
          {!depositOnly && onEnableSession && !sessionActive && (
            <>
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-charcoal-light" />
                <span className="text-[10px] text-cream/20 uppercase tracking-wider">or</span>
                <div className="h-px flex-1 bg-charcoal-light" />
              </div>

              {showSessionSetup ? (
                /* Session setup: deposit input + tip */
                <div className="flex flex-col gap-3 rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3">
                  {(userDeposit ?? 0) > 0 ? (
                    <p className="text-center text-[11px] text-cream/40">
                      You have {formatSOL(userDeposit ?? 0)} SOL deposited.
                      {(userDeposit ?? 0) < minBid
                        ? ` Need at least ${formatSOL(minBid)} SOL for the minimum bid. Add more?`
                        : " Want to add more?"}
                    </p>
                  ) : (
                    <p className="text-center text-[11px] text-cream/40">
                      How much SOL do you want to budget for bidding?
                    </p>
                  )}
                  <div className="relative">
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={sessionDepositInput}
                      onChange={(e) => setSessionDepositInput(e.target.value)}
                      aria-label="Additional deposit in SOL"
                      className="w-full rounded-md border border-charcoal-light bg-jet px-3 py-2 pr-12 text-right text-sm tabular-nums text-cream outline-none transition-colors focus:border-emerald-500/50"
                    />
                    <span className="absolute top-1/2 right-3 -translate-y-1/2 text-[10px] text-cream/30 uppercase">
                      SOL
                    </span>
                  </div>
                  <p className="text-center text-[10px] text-cream/25 leading-relaxed">
                    Deposit your max budget upfront. Quick bids only work
                    up to your deposited amount.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowSessionSetup(false)}
                      className="flex h-9 flex-1 items-center justify-center rounded-md border border-charcoal-light text-xs font-medium text-cream/40 transition-all hover:border-cream/20"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        const lamports = parseSolToLamports(sessionDepositInput);
                        onEnableSession(lamports);
                        setShowSessionSetup(false);
                      }}
                      disabled={sessionActivating || isLoading}
                      className="flex h-9 flex-1 items-center justify-center rounded-md bg-emerald-500 text-xs font-semibold text-jet transition-all hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {sessionActivating ? (
                        <div className="flex items-center gap-2">
                          <Spinner />
                          <span className="text-[10px] normal-case tracking-normal">
                            {sessionActivationProgress ?? "Activating..."}
                          </span>
                        </div>
                      ) : (
                        "Activate"
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                /* Button: one-click resume if deposit covers minBid, otherwise show setup */
                <button
                  onClick={() => {
                    if ((userDeposit ?? 0) >= minBid) {
                      // Enough deposit — skip setup, activate directly with 0 additional deposit
                      onEnableSession(0);
                    } else {
                      setShowSessionSetup(true);
                    }
                  }}
                  disabled={sessionActivating || isLoading}
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-emerald-500/30 text-xs font-medium text-emerald-400/80 transition-all hover:border-emerald-500/50 hover:bg-emerald-500/5 hover:text-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {sessionActivating ? (
                    <div className="flex items-center gap-2">
                      <Spinner />
                      <span className="text-xs font-medium normal-case tracking-normal">
                        {sessionActivationProgress ?? "Activating..."}
                      </span>
                    </div>
                  ) : (userDeposit ?? 0) >= minBid ? (
                    "Resume Quick Bidding"
                  ) : (
                    "Enable Quick Bidding"
                  )}
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
