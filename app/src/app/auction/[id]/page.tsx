"use client";

import { useState, useEffect, useCallback, useMemo, use } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Connection, PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import BN from "bn.js";
import { useAuction, parseAuctionStatus } from "@/hooks/useAuction";
import { useAuctionActions } from "@/hooks/useAuctionActions";
import { useBidderDeposit } from "@/hooks/useBidderDeposit";
import AuctionStatus from "@/components/auction/AuctionStatus";
import CountdownTimer from "@/components/auction/CountdownTimer";
import BidPanel from "@/components/auction/BidPanel";
import BidHistory from "@/components/auction/BidHistory";
import ProfileBadge from "@/components/social/ProfileBadge";
import FollowButton from "@/components/social/FollowButton";
import LikeButton from "@/components/social/LikeButton";
import CommentSection from "@/components/social/CommentSection";
import { truncateAddress, formatSOL } from "@/lib/utils";
import { useTapestryProfile } from "@/hooks/useTapestryProfile";
import { getProfile, createContent } from "@/lib/tapestry";
import { DELEGATION_PROGRAM_ID, DEVNET_RPC } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Toast notification
// ---------------------------------------------------------------------------

interface Toast {
  id: number;
  message: string;
  type: "success" | "error";
}

function ToastNotification({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 4000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.95 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={`rounded-lg border px-5 py-3 text-sm shadow-lg backdrop-blur-sm ${
        toast.type === "success"
          ? "border-gold/30 bg-gold/10 text-gold"
          : "border-red-500/30 bg-red-500/10 text-red-400"
      }`}
    >
      {toast.message}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedHue(address: string): number {
  let hash = 0;
  for (let i = 0; i < address.length; i++) {
    hash = address.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AuctionRoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { auction, loading, error, refetch } = useAuction(id);
  const actions = useAuctionActions();
  const { publicKey } = useWallet();

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [actionLoading, setActionLoading] = useState(false);

  const addToast = useCallback(
    (message: string, type: "success" | "error") => {
      const newToast: Toast = { id: Date.now(), message, type };
      setToasts((prev) => [...prev, newToast]);
    },
    []
  );

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Check ER delegation status
  const l1Connection = useMemo(() => new Connection(DEVNET_RPC, "confirmed"), []);
  const [isDelegated, setIsDelegated] = useState<boolean | null>(null);

  useEffect(() => {
    if (!id) {
      setIsDelegated(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const auctionPubkey = new PublicKey(id);
        const [delegationRecord] = PublicKey.findProgramAddressSync(
          [Buffer.from("delegation"), auctionPubkey.toBuffer()],
          DELEGATION_PROGRAM_ID
        );
        const info = await l1Connection.getAccountInfo(delegationRecord);
        if (!cancelled) setIsDelegated(info !== null);
      } catch {
        if (!cancelled) setIsDelegated(null);
      }
    })();
    return () => { cancelled = true; };
  }, [id, l1Connection, auction]); // re-check when auction state changes

  // Derive status
  const statusLabel = auction ? parseAuctionStatus(auction.status) : null;
  const isSeller =
    auction && publicKey
      ? auction.seller.toBase58() === publicKey.toBase58()
      : false;
  const isActive = statusLabel === "Active";
  const isCreated = statusLabel === "Created";
  const isEnded = statusLabel === "Ended";
  const isSettled = statusLabel === "Settled";
  const isCancelled = statusLabel === "Cancelled";

  // Fetch user's BidderDeposit PDA (lives on L1, works even when auction is delegated)
  const { deposit: bidderDepositAccount, refetch: refetchDeposit } = useBidderDeposit(
    id,
    publicKey?.toBase58() ?? null
  );
  const userDeposit = bidderDepositAccount?.amount?.toNumber() ?? null;

  // Action handlers
  const handleDeposit = useCallback(
    async (lamports: number) => {
      if (!auction) return;
      setActionLoading(true);
      try {
        await actions.deposit(new PublicKey(id), new BN(lamports));
        addToast("Deposit successful", "success");
        await Promise.all([refetch(), refetchDeposit()]);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Deposit failed";
        addToast(msg, "error");
      } finally {
        setActionLoading(false);
      }
    },
    [auction, actions, id, addToast, refetch, refetchDeposit]
  );

  const handleBid = useCallback(
    async (lamports: number) => {
      if (!auction) return;
      setActionLoading(true);
      try {
        await actions.placeBid(new PublicKey(id), new BN(lamports));
        addToast("Bid placed!", "success");
        await refetch();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Bid failed";
        addToast(msg, "error");
      } finally {
        setActionLoading(false);
      }
    },
    [auction, actions, id, addToast, refetch]
  );

  const handleStartAuction = useCallback(async () => {
    if (!auction) return;
    setActionLoading(true);
    try {
      await actions.startAuction(
        new PublicKey(id),
        auction.nftMint
      );
      addToast("Auction started!", "success");
      await refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to start";
      addToast(msg, "error");
    } finally {
      setActionLoading(false);
    }
  }, [auction, actions, id, addToast, refetch]);

  const handleSettleAuction = useCallback(async () => {
    if (!auction) return;
    setActionLoading(true);
    try {
      await actions.settleAuction(
        new PublicKey(id),
        auction.nftMint,
        auction.seller,
        auction.highestBidder
      );
      addToast("Auction settled!", "success");
      await refetch();

      // Post auction result to Tapestry (best-effort, don't block on failure)
      if (publicKey) {
        const winnerAddr = auction.highestBidder?.toBase58() ?? "unknown";
        const winBid = formatSOL(auction.currentBid.toNumber());
        const content = `Auction settled! NFT ${truncateAddress(auction.nftMint.toBase58())} sold for ${winBid} SOL to ${truncateAddress(winnerAddr)}. Going, going, onchain.`;

        getProfile(publicKey.toBase58())
          .then((profile) => {
            if (profile?.profile.id) {
              return createContent(profile.profile.id, content, {
                auctionId: id,
                type: "auction_settled",
                nftMint: auction.nftMint.toBase58(),
                winner: winnerAddr,
                amount: auction.currentBid.toString(),
              });
            }
          })
          .catch(() => {
            // Silently ignore — social posting is best-effort
          });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Settlement failed";
      addToast(msg, "error");
    } finally {
      setActionLoading(false);
    }
  }, [auction, actions, id, addToast, refetch, publicKey]);

  const handleDelegateAuction = useCallback(async () => {
    if (!auction) return;
    setActionLoading(true);
    try {
      await actions.delegateAuction(
        new PublicKey(id),
        auction.nftMint
      );
      addToast("Auction delegated to Ephemeral Rollup!", "success");
      await refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Delegation failed";
      addToast(msg, "error");
    } finally {
      setActionLoading(false);
    }
  }, [auction, actions, id, addToast, refetch]);

  const handleUndelegateAuction = useCallback(async () => {
    if (!auction) return;
    setActionLoading(true);
    try {
      await actions.undelegateAuction(new PublicKey(id));
      addToast("Auction undelegated back to L1!", "success");
      await refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Undelegation failed";
      addToast(msg, "error");
    } finally {
      setActionLoading(false);
    }
  }, [auction, actions, id, addToast, refetch]);

  const handleClaimRefund = useCallback(async () => {
    if (!auction) return;
    setActionLoading(true);
    try {
      await actions.claimRefund(new PublicKey(id));
      addToast("Refund claimed!", "success");
      await refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Refund failed";
      addToast(msg, "error");
    } finally {
      setActionLoading(false);
    }
  }, [auction, actions, id, addToast, refetch]);

  // Hue for artwork placeholder
  const hue = seedHue(id);

  // Bid history — currently shows current bid as latest entry.
  // Real bid history would come from transaction logs / events.
  const bidHistory =
    auction && auction.currentBid.toNumber() > 0
      ? [
          {
            bidder: auction.highestBidder.toBase58(),
            amount: auction.currentBid.toNumber(),
            timestamp: Math.floor(Date.now() / 1000),
          },
        ]
      : [];

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />
          <p className="text-xs tracking-[0.2em] text-cream/40 uppercase">
            Loading auction...
          </p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Error state
  // ---------------------------------------------------------------------------
  if (error || !auction) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="font-serif text-2xl italic text-cream/30">
            Auction not found
          </p>
          <p className="max-w-sm text-sm text-cream/20">
            {error ||
              "This auction may not exist or your wallet may not be connected."}
          </p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="relative min-h-screen">
      {/* Toast container */}
      <div className="fixed right-6 bottom-6 z-50 flex flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <ToastNotification key={t.id} toast={t} onDismiss={dismissToast} />
          ))}
        </AnimatePresence>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="mx-auto max-w-7xl px-6 pt-8 pb-24"
      >
        {/* Two-column layout */}
        <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
          {/* ============================================================= */}
          {/* LEFT: Artwork + info (60%)                                     */}
          {/* ============================================================= */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="flex-1 lg:max-w-[60%]"
          >
            {/* Artwork display */}
            <div
              className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl"
              style={{
                background: `linear-gradient(135deg, hsl(${hue}, 15%, 8%) 0%, hsl(${(hue + 40) % 360}, 20%, 12%) 50%, hsl(${(hue + 80) % 360}, 10%, 6%) 100%)`,
              }}
            >
              {/* Grid overlay */}
              <div
                className="absolute inset-0 opacity-[0.03]"
                style={{
                  backgroundImage:
                    "linear-gradient(rgba(198,169,97,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(198,169,97,0.5) 1px, transparent 1px)",
                  backgroundSize: "60px 60px",
                }}
              />
              <span className="font-serif text-lg italic text-cream/10">
                NFT ARTWORK
              </span>
            </div>

            {/* Seller + NFT info */}
            <div className="mt-6 flex flex-col gap-4 border-t border-charcoal-light pt-6">
              {/* Seller profile row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <ProfileBadge walletAddress={auction.seller.toBase58()} size="md" />
                </div>
                <FollowButton targetWallet={auction.seller.toBase58()} />
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] tracking-[0.2em] text-cream/30 uppercase">
                    NFT Mint
                  </span>
                  <span className="font-mono text-xs text-cream/60">
                    {truncateAddress(auction.nftMint.toBase58())}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] tracking-[0.2em] text-cream/30 uppercase">
                    Reserve Price
                  </span>
                  <span className="text-xs tabular-nums text-cream/60">
                    {formatSOL(auction.reservePrice.toNumber())} SOL
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] tracking-[0.2em] text-cream/30 uppercase">
                    Total Bids
                  </span>
                  <span className="text-xs tabular-nums text-cream/60">
                    {auction.bidCount}
                  </span>
                </div>
              </div>

              {/* Like button */}
              <div className="flex items-center gap-2 border-t border-charcoal-light/50 pt-3">
                <LikeButton
                  auctionId={id}
                  userProfileId={publicKey?.toBase58() ?? null}
                />
              </div>
            </div>
          </motion.div>

          {/* ============================================================= */}
          {/* RIGHT: Auction control panel (40%)                             */}
          {/* ============================================================= */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="flex flex-col gap-6 lg:w-[40%]"
          >
            {/* Status badge + delegation indicator */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <AuctionStatus status={auction.status} />
                {isDelegated !== null && (
                  <span
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium tracking-[0.1em] uppercase ${
                      isDelegated
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                        : "border-cream/10 bg-cream/5 text-cream/30"
                    }`}
                  >
                    <span
                      className={`inline-block h-1.5 w-1.5 rounded-full ${
                        isDelegated ? "bg-emerald-400 animate-pulse" : "bg-cream/30"
                      }`}
                    />
                    {isDelegated ? "ER Live" : "L1"}
                  </span>
                )}
              </div>
              {isActive && auction.highestBidder && (
                <span className="text-[10px] tracking-[0.15em] text-cream/30 uppercase">
                  Leader:{" "}
                  <span className="text-gold/70">
                    {truncateAddress(auction.highestBidder.toBase58())}
                  </span>
                </span>
              )}
            </div>

            {/* Countdown timer */}
            <div className="flex justify-center rounded-lg border border-charcoal-light bg-charcoal px-6 py-6">
              <CountdownTimer
                endTime={auction.endTime.toNumber()}
                status={statusLabel?.toLowerCase() ?? "created"}
              />
            </div>

            {/* Current bid display */}
            <div className="flex flex-col items-center rounded-lg border border-charcoal-light bg-charcoal px-6 py-5">
              <span className="mb-1 text-[10px] tracking-[0.25em] text-cream/40 uppercase">
                {auction.currentBid.toNumber() > 0
                  ? "Current Bid"
                  : "Reserve Price"}
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold tabular-nums text-gold">
                  {auction.currentBid.toNumber() > 0
                    ? formatSOL(auction.currentBid.toNumber())
                    : formatSOL(auction.reservePrice.toNumber())}
                </span>
                <span className="text-sm font-medium text-gold/50 uppercase">
                  SOL
                </span>
              </div>
              {auction.currentBid.toNumber() > 0 &&
                auction.highestBidder &&
                auction.highestBidder.toBase58() !== "11111111111111111111111111111111" && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="text-[10px] text-cream/30">by</span>
                    <BidderName wallet={auction.highestBidder.toBase58()} />
                  </div>
                )}
            </div>

            {/* Bid Panel (during Created or Active) */}
            {(isActive || isCreated) && (
              <BidPanel
                auctionState={{
                  currentBid: auction.currentBid.toNumber(),
                  highestBidder: auction.highestBidder?.toBase58() ?? null,
                  status: auction.status,
                  reservePrice: auction.reservePrice.toNumber(),
                }}
                onBid={handleBid}
                onDeposit={handleDeposit}
                userDeposit={userDeposit}
                isLoading={actionLoading}
                isSeller={isSeller}
              />
            )}

            {/* Action buttons based on status */}
            <div className="flex flex-col gap-3">
              {/* Created + seller: Start Auction (L1 only — don't auto-delegate) */}
              {isCreated && isSeller && (
                <button
                  onClick={handleStartAuction}
                  disabled={actionLoading}
                  className="flex h-12 w-full items-center justify-center rounded-md bg-gold text-sm font-semibold tracking-[0.15em] text-jet uppercase transition-all duration-200 hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {actionLoading ? <Spinner /> : "Start Auction"}
                </button>
              )}

              {/* Created + not seller: BidPanel already shown above */}

              {/* Active + seller + not delegated: Go live on ER */}
              {isActive && isSeller && isDelegated === false && (
                <div className="flex flex-col gap-2">
                  <button
                    onClick={handleDelegateAuction}
                    disabled={actionLoading}
                    className="flex h-12 w-full items-center justify-center rounded-md bg-emerald-600 text-sm font-semibold tracking-[0.15em] text-white uppercase transition-all duration-200 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {actionLoading ? <Spinner /> : "Go Live on ER"}
                  </button>
                  <p className="text-center text-[10px] text-cream/25">
                    Delegates to Ephemeral Rollup for sub-50ms bidding. Deposits still work after this.
                  </p>
                </div>
              )}

              {/* Ended: Undelegate + Settle */}
              {isEnded && (
                <button
                  onClick={async () => {
                    setActionLoading(true);
                    try {
                      // Try to undelegate first (if delegated), then settle
                      try {
                        await actions.undelegateAuction(new PublicKey(id));
                        addToast("Undelegated from ER. Settling...", "success");
                        await new Promise((r) => setTimeout(r, 3000));
                      } catch {
                        // May not be delegated — continue to settle
                      }
                      await actions.settleAuction(
                        new PublicKey(id),
                        auction.nftMint,
                        auction.seller,
                        auction.highestBidder
                      );
                      addToast("Auction settled!", "success");
                      await refetch();
                    } catch (err: unknown) {
                      const msg = err instanceof Error ? err.message : "Settlement failed";
                      addToast(msg, "error");
                    } finally {
                      setActionLoading(false);
                    }
                  }}
                  disabled={actionLoading}
                  className="flex h-12 w-full items-center justify-center rounded-md bg-gold text-sm font-semibold tracking-[0.15em] text-jet uppercase transition-all duration-200 hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {actionLoading ? <Spinner /> : "Settle Auction"}
                </button>
              )}

              {/* Settled or Cancelled: Claim Refund (for bidders with deposits) */}
              {(isSettled || isCancelled) && userDeposit && userDeposit > 0 && (
                <button
                  onClick={handleClaimRefund}
                  disabled={actionLoading}
                  className="flex h-12 w-full items-center justify-center rounded-md border border-gold/40 text-sm font-medium tracking-[0.15em] text-gold uppercase transition-all duration-200 hover:border-gold hover:bg-gold/5 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {actionLoading ? <Spinner /> : "Claim Refund"}
                </button>
              )}
            </div>

            {/* Bid History */}
            <div className="rounded-lg border border-charcoal-light bg-charcoal p-5">
              <BidHistory bids={bidHistory} />
            </div>

            {/* Comments */}
            <CommentSection auctionId={id} />
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BidderName — resolves Tapestry username, falls back to truncated address
// ---------------------------------------------------------------------------

function BidderName({ wallet }: { wallet: string }) {
  const { profile } = useTapestryProfile(wallet);
  const display = profile?.profile.username || truncateAddress(wallet);

  return (
    <a
      href={`/profile/${wallet}`}
      className="text-[11px] font-medium text-gold/70 transition-colors hover:text-gold"
    >
      {display}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

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
