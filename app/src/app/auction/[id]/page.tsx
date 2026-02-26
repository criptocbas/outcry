"use client";

import { useState, useEffect, useCallback, useMemo, useRef, use } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Connection, PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import BN from "bn.js";
import { useAuction, parseAuctionStatus } from "@/hooks/useAuction";
import { useAuctionActions } from "@/hooks/useAuctionActions";
import { useBidderDeposit } from "@/hooks/useBidderDeposit";
import { useSessionBidding } from "@/hooks/useSessionBidding";
import AuctionStatus from "@/components/auction/AuctionStatus";
import CountdownTimer from "@/components/auction/CountdownTimer";
import BidPanel from "@/components/auction/BidPanel";
import BidHistory from "@/components/auction/BidHistory";
import ProfileBadge from "@/components/social/ProfileBadge";
import FollowButton from "@/components/social/FollowButton";
import LikeButton from "@/components/social/LikeButton";
import CommentSection from "@/components/social/CommentSection";
import { truncateAddress, formatSOL } from "@/lib/utils";
import Spinner from "@/components/ui/Spinner";
import { useTapestryProfile, prefetchProfiles } from "@/hooks/useTapestryProfile";
import { useNftMetadata } from "@/hooks/useNftMetadata";
import { getProfile, createContent } from "@/lib/tapestry";
import { getAuctionBidders, getDepositPDA, getReadOnlyProgram } from "@/lib/program";
import { DELEGATION_PROGRAM_ID, DEVNET_RPC, MAGIC_ROUTER_RPC } from "@/lib/constants";
import NftImage from "@/components/auction/NftImage";

// ---------------------------------------------------------------------------
// Error message extraction
// ---------------------------------------------------------------------------

function extractErrorMessage(err: unknown, fallback: string): string {
  // Try standard Error.message first
  if (err instanceof Error && err.message) {
    const msg = err.message;

    // Solana insufficient funds
    if (msg.includes("0x1") || msg.includes("insufficient") || msg.includes("Insufficient")) {
      return "Insufficient SOL balance";
    }
    // User rejected in wallet
    if (msg.includes("User rejected") || msg.includes("rejected the request")) {
      return "Transaction rejected";
    }
    // Wallet disconnected
    if (msg.includes("Wallet not connected") || msg.includes("WalletNotConnectedError")) {
      return "Wallet disconnected — please reconnect";
    }
    // Anchor program errors — extract the readable part
    if (msg.includes("custom program error")) {
      const anchorMsg = msg.match(/Error Message: (.+?)\.?$/m)?.[1];
      if (anchorMsg) return anchorMsg;
    }
    // SendTransactionError may wrap the real message
    const errObj = err as { transactionMessage?: string; logs?: string[] };
    if (errObj.transactionMessage) return errObj.transactionMessage;

    return msg;
  }

  // Some errors are plain objects with a message field
  if (err && typeof err === "object" && "message" in err) {
    const msg = String((err as { message: unknown }).message);
    if (msg && msg !== "undefined") return msg;
  }

  return fallback;
}

// ---------------------------------------------------------------------------
// Toast notification
// ---------------------------------------------------------------------------

interface Toast {
  id: number;
  message: string;
  type: "success" | "error";
  link?: string;
}

const explorerUrl = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

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
      role="alert"
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
      <span>{toast.message}</span>
      {toast.link && (
        <a
          href={toast.link}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-2 underline decoration-current/40 underline-offset-2 hover:decoration-current/80"
        >
          View tx
        </a>
      )}
    </motion.div>
  );
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
  const walletAddress = publicKey?.toBase58() ?? null;
  const { profile: myTapestryProfile } = useTapestryProfile(walletAddress);
  const myProfileId = myTapestryProfile?.profile?.id ?? null;
  const { metadata: nftMetadata } = useNftMetadata(auction?.nftMint?.toBase58() ?? null);
  const session = useSessionBidding();

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [bidFlash, setBidFlash] = useState(false);
  const [settleConfirm, setSettleConfirm] = useState(false);
  const [settleFailed, setSettleFailed] = useState(false);
  const [prevBid, setPrevBid] = useState<number | null>(null);
  const [prevHighestBidder, setPrevHighestBidder] = useState<string | null>(null);
  const [bidHistory, setBidHistory] = useState<Array<{ bidder: string; amount: number; timestamp: number }>>([]);
  const [lastBidSpeedMs, setLastBidSpeedMs] = useState<number | null>(null);
  const toastIdRef = useRef(0);

  const addToast = useCallback(
    (message: string, type: "success" | "error", link?: string) => {
      setToasts((prev) => {
        // Deduplicate: skip if identical message already showing
        if (prev.some((t) => t.message === message)) return prev;
        toastIdRef.current += 1;
        const newToast: Toast = { id: toastIdRef.current, message, type, link };
        // Limit to 3 concurrent toasts — drop oldest
        const updated = [...prev, newToast];
        return updated.length > 3 ? updated.slice(-3) : updated;
      });
    },
    []
  );

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Detect bid changes for flash animation, outbid notification, + history accumulation
  useEffect(() => {
    if (!auction) return;
    const currentBid = auction.currentBid.toNumber();
    const currentBidder = auction.highestBidder?.toBase58() ?? null;

    if (prevBid === null && currentBid > 0 && currentBidder) {
      // First load — seed history with the existing highest bid
      setBidHistory([{
        bidder: currentBidder,
        amount: currentBid,
        timestamp: auction.startTime.toNumber(),
      }]);
    } else if (prevBid !== null && currentBid > prevBid && currentBidder) {
      // New bid arrived — trigger flash
      setBidFlash(true);
      setTimeout(() => setBidFlash(false), 800);

      // Pre-warm cache for new bidder so username resolves instantly
      if (currentBidder) {
        prefetchProfiles([currentBidder]);
      }

      // Accumulate into history (deduplicate by amount — bids are strictly increasing)
      setBidHistory(prev => {
        if (prev.some(b => b.amount === currentBid)) return prev;
        return [
          ...prev,
          {
            bidder: currentBidder,
            amount: currentBid,
            timestamp: Math.floor(Date.now() / 1000),
          },
        ];
      });

      // Check if user was outbid
      if (
        publicKey &&
        prevHighestBidder === publicKey.toBase58() &&
        currentBidder !== publicKey.toBase58()
      ) {
        addToast("You've been outbid!", "error");
      }
    }

    setPrevBid(currentBid);
    setPrevHighestBidder(currentBidder);
  }, [auction?.currentBid?.toString(), auction?.highestBidder?.toBase58()]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute clock offset (chain time - client time) for accurate countdown
  const l1Connection = useMemo(() => new Connection(DEVNET_RPC, "confirmed"), []);
  const [clockOffset, setClockOffset] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const slot = await l1Connection.getSlot();
        const blockTime = await l1Connection.getBlockTime(slot);
        if (blockTime && !cancelled) {
          setClockOffset(blockTime - Math.floor(Date.now() / 1000));
        }
      } catch { /* non-critical */ }
    })();
    return () => { cancelled = true; };
  }, [l1Connection]);

  // Pre-warm Tapestry profile cache on initial auction load
  // so usernames resolve instantly when bids appear.
  const prewarmDoneRef = useRef(false);
  useEffect(() => {
    if (!auction || prewarmDoneRef.current) return;
    prewarmDoneRef.current = true;

    const addresses: string[] = [auction.seller.toBase58()];
    const bidder = auction.highestBidder?.toBase58();
    if (bidder && bidder !== "11111111111111111111111111111111") {
      addresses.push(bidder);
    }
    // Also prefetch all known depositors (bidders) in the background
    const auctionPubkey = new PublicKey(id);
    getAuctionBidders(l1Connection, auctionPubkey)
      .then((bidders) => {
        const all = [...addresses, ...bidders.map((b) => b.toBase58())];
        prefetchProfiles([...new Set(all)]);
      })
      .catch(() => {
        // Fallback: just prefetch seller + highest bidder
        prefetchProfiles(addresses);
      });
  }, [auction, id, l1Connection]);

  // Check ER delegation status
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
  const timerExpired =
    auction && auction.endTime.toNumber() > 0 &&
    Math.floor(Date.now() / 1000) + clockOffset >= auction.endTime.toNumber();
  const canSettle = !isSettled && !isCancelled && (isEnded || (isActive && timerExpired));
  const isWinner =
    auction && publicKey && auction.highestBidder
      ? auction.highestBidder.toBase58() === publicKey.toBase58()
      : false;

  // ER health check — ping Magic Router when auction is active + delegated
  const [erHealthy, setErHealthy] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isActive || !isDelegated) {
      setErHealthy(null);
      return;
    }
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(MAGIC_ROUTER_RPC, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestBlockhash", params: [{ commitment: "confirmed" }] }),
        });
        const json = await res.json();
        if (!cancelled) setErHealthy(!!json?.result?.value?.blockhash);
      } catch {
        if (!cancelled) setErHealthy(false);
      }
    };
    check();
    const interval = setInterval(check, 30_000); // re-check every 30s
    return () => { cancelled = true; clearInterval(interval); };
  }, [isActive, isDelegated]);

  // Fetch user's BidderDeposit PDA (lives on L1, works even when auction is delegated)
  const { deposit: bidderDepositAccount, wasRefunded, refetch: refetchDeposit } = useBidderDeposit(
    id,
    publicKey?.toBase58() ?? null
  );
  const userDeposit = bidderDepositAccount?.amount?.toNumber() ?? null;

  // -------------------------------------------------------------------------
  // Smart bid handler: auto-deposits if needed, then places bid
  // -------------------------------------------------------------------------
  const handleBid = useCallback(
    async (bidLamports: number) => {
      if (!auction || !publicKey) return;
      setActionLoading(true);
      setProgressLabel(null);

      try {
        // Session mode: instant bid via ephemeral key (no wallet popup)
        if (session.sessionActive) {
          setProgressLabel("Quick bid...");
          const { sendMs } = await session.sessionBid(new PublicKey(id), bidLamports);
          setLastBidSpeedMs(sendMs);
          addToast(`Quick bid: ${formatSOL(bidLamports)} SOL — ${sendMs}ms`, "success");
          await refetch();
          return;
        }

        // Standard mode: auto-deposit if needed, then wallet-signed bid
        const currentDeposit = bidderDepositAccount?.amount?.toNumber() ?? 0;
        const depositNeeded = Math.max(0, bidLamports - currentDeposit);

        // Step 1: Auto-deposit if needed
        if (depositNeeded > 0) {
          setProgressLabel("Depositing SOL...");
          const depSig = await actions.deposit(new PublicKey(id), new BN(depositNeeded));
          addToast(`Deposited ${formatSOL(depositNeeded)} SOL`, "success", explorerUrl(depSig));
          await refetchDeposit();
        }

        // Step 2: Place bid
        setProgressLabel("Placing bid...");
        const { sendMs } = await actions.placeBid(new PublicKey(id), new BN(bidLamports));
        setLastBidSpeedMs(sendMs);
        addToast(`Bid placed: ${formatSOL(bidLamports)} SOL — ${sendMs}ms via Ephemeral Rollup`, "success");
        await refetch();
      } catch (err: unknown) {
        const msg = extractErrorMessage(err, "Bid failed");
        addToast(msg, "error");
        // If session bid fails, disable session so user can fall back
        if (session.sessionActive) {
          session.disableSession();
          addToast("Session expired — re-enable Quick Bidding to continue", "error");
        }
      } finally {
        setActionLoading(false);
        setProgressLabel(null);
      }
    },
    [auction, actions, id, publicKey, addToast, refetch, refetchDeposit, bidderDepositAccount, session]
  );

  // -------------------------------------------------------------------------
  // Enable session bidding: deposit + fund ephemeral key + create session
  // -------------------------------------------------------------------------
  const handleEnableSession = useCallback(
    async (depositAmount: number) => {
      if (!publicKey) return;
      try {
        await session.enableSession(new PublicKey(id), depositAmount);
        addToast("Quick Bidding enabled — bids are now instant!", "success");
        await refetchDeposit();
      } catch (err: unknown) {
        const msg = extractErrorMessage(err, "Failed to enable Quick Bidding");
        addToast(msg, "error");
      }
    },
    [session, id, publicKey, addToast, refetchDeposit]
  );

  // -------------------------------------------------------------------------
  // Top up deposit during active session (one wallet popup)
  // -------------------------------------------------------------------------
  const handleTopUpDeposit = useCallback(
    async (amount: number) => {
      if (!publicKey) return;
      setActionLoading(true);
      setProgressLabel("Depositing SOL...");
      try {
        const depSig = await actions.deposit(new PublicKey(id), new BN(amount));
        addToast(`Deposited ${formatSOL(amount)} SOL`, "success", explorerUrl(depSig));
        await refetchDeposit();
      } catch (err: unknown) {
        const msg = extractErrorMessage(err, "Deposit failed");
        addToast(msg, "error");
      } finally {
        setActionLoading(false);
        setProgressLabel(null);
      }
    },
    [actions, id, publicKey, addToast, refetchDeposit]
  );

  // -------------------------------------------------------------------------
  // Go Live: Start + Delegate in one click
  // -------------------------------------------------------------------------
  const handleGoLive = useCallback(async () => {
    if (!auction || !publicKey) return;
    setActionLoading(true);
    setProgressLabel(null);

    try {
      // Step 1: Start auction (if still Created)
      if (isCreated) {
        setProgressLabel("Starting auction...");
        const startSig = await actions.startAuction(new PublicKey(id), auction.nftMint);
        addToast("Auction started!", "success", explorerUrl(startSig));
        await refetch();
      }

      // Step 2: Delegate to ER
      setProgressLabel("Delegating to Ephemeral Rollup...");
      const delSig = await actions.delegateAuction(new PublicKey(id), auction.nftMint);
      // Wait for the ER to sync the delegated account before allowing bids.
      // Without this, immediate bids can fail with "account not found" on ER.
      setProgressLabel("Syncing with Ephemeral Rollup...");
      await new Promise((r) => setTimeout(r, 3000));
      addToast("Live on Ephemeral Rollup!", "success", explorerUrl(delSig));
      await refetch();
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, "Failed to go live");
      addToast(msg, "error");
    } finally {
      setActionLoading(false);
      setProgressLabel(null);
    }
  }, [auction, actions, id, addToast, refetch, isCreated]);

  // -------------------------------------------------------------------------
  // Settle: Undelegate (if needed) + Settle in one click
  // -------------------------------------------------------------------------
  const handleSettle = useCallback(async () => {
    if (!auction || !publicKey) return;
    setActionLoading(true);
    setProgressLabel(null);

    try {
      // Refetch fresh state to avoid acting on stale data
      setProgressLabel("Checking auction state...");
      const auctionPubkey = new PublicKey(id);
      const [delegationRecord] = PublicKey.findProgramAddressSync(
        [Buffer.from("delegation"), auctionPubkey.toBuffer()],
        DELEGATION_PROGRAM_ID
      );

      // Fetch delegation status and auction state in parallel
      const readProgram = getReadOnlyProgram(l1Connection);
      const [delegationInfo, freshAuctionRaw] = await Promise.all([
        l1Connection.getAccountInfo(delegationRecord),
        (readProgram.account as Record<string, { fetchNullable: (key: PublicKey) => Promise<unknown> }>)["auctionState"]
          .fetchNullable(auctionPubkey)
          .catch(() => null),
      ]);
      const freshIsDelegated = delegationInfo !== null;

      // Use fresh data if available, fall back to current React state
      type AuctionLike = { status: Parameters<typeof parseAuctionStatus>[0]; nftMint: PublicKey; seller: PublicKey; highestBidder: PublicKey; currentBid: { toNumber: () => number } };
      const freshAuction = (freshAuctionRaw as AuctionLike | null) ?? auction;
      const freshStatus = freshAuction ? parseAuctionStatus(freshAuction.status) : statusLabel;
      const freshIsActive = freshStatus === "Active";

      // Step 1: End auction if timer expired but status is still Active
      if (freshIsActive && timerExpired) {
        setProgressLabel("Ending auction...");
        try {
          await actions.endAuction(new PublicKey(id));
          addToast("Auction ended", "success");
        } catch (endErr: unknown) {
          const endMsg = endErr instanceof Error ? endErr.message : "";
          // Ignore if already ended
          if (!endMsg.includes("InvalidAuctionStatus")) {
            throw new Error(`End auction failed: ${endMsg || "Unknown error"}`);
          }
        }
        // sendErTransaction now awaits confirmation, but add a short buffer
        // for ER state propagation before undelegation
        setProgressLabel("Waiting for confirmation...");
        await new Promise((r) => setTimeout(r, 1000));
      }

      // Step 2: Undelegate from ER (if delegated)
      if (freshIsDelegated) {
        setProgressLabel("Returning state to L1...");
        try {
          await actions.undelegateAuction(new PublicKey(id));
          addToast("Undelegated from ER", "success");
        } catch (undelegateErr: unknown) {
          const undelegateMsg = undelegateErr instanceof Error ? undelegateErr.message : "";
          // Only ignore if truly not delegated
          if (undelegateMsg.includes("not delegated") || undelegateMsg.includes("AccountNotDelegated")) {
            // Not delegated — safe to continue
          } else {
            throw new Error(`Undelegate failed: ${undelegateMsg || "Unknown error"}`);
          }
        }

        // Poll L1 to verify state is back (up to 30 seconds)
        setProgressLabel("Waiting for L1 confirmation...");
        let stateOnL1 = false;
        for (let attempt = 0; attempt < 15; attempt++) {
          await new Promise((r) => setTimeout(r, 2000));
          try {
            const info = await l1Connection.getAccountInfo(delegationRecord);
            if (info === null) {
              // Delegation record gone — state is back on L1
              stateOnL1 = true;
              break;
            }
          } catch {
            // RPC error — keep trying
          }
        }
        if (!stateOnL1) {
          throw new Error("Timed out waiting for state to return to L1. Try again in a few seconds.");
        }
        addToast("State confirmed on L1", "success");
      }

      // Step 3: Settle (use freshAuction for latest on-chain data)
      if (!freshAuction) {
        throw new Error("Could not read auction state. Please refresh and try again.");
      }

      // If already settled/cancelled, skip
      if (freshStatus === "Settled" || freshStatus === "Cancelled") {
        addToast(`Auction already ${freshStatus.toLowerCase()}`, "success");
        await refetch();
        setActionLoading(false);
        setProgressLabel(null);
        return;
      }

      setProgressLabel("Settling auction...");
      try {
        const settleSig = await actions.settleAuction(
          auctionPubkey,
          freshAuction.nftMint,
          freshAuction.seller,
          freshAuction.highestBidder
        );
        addToast("Auction settled!", "success", explorerUrl(settleSig));
      } catch (settleErr: unknown) {
        console.error("[handleSettle] settle error:", settleErr);
        const settleMsg = settleErr instanceof Error ? settleErr.message : String(settleErr);
        // If settlement failed (likely insufficient deposit), try forfeit
        if (settleMsg.includes("InsufficientDeposit") || settleMsg.includes("0x1776")) {
          setProgressLabel("Winner defaulted — forfeiting auction...");
          const forfeitSig = await actions.forfeitAuction(
            auctionPubkey,
            freshAuction.nftMint,
            freshAuction.seller,
            freshAuction.highestBidder
          );
          addToast("Auction forfeited — NFT returned to seller, winner deposit slashed", "success", explorerUrl(forfeitSig));
        } else {
          throw new Error(`Settle failed: ${settleMsg || "Unknown error"}`);
        }
      }
      await Promise.all([refetch(), refetchDeposit()]);

      // Post auction result to Tapestry (best-effort)
      if (publicKey) {
        const winnerAddr = freshAuction.highestBidder?.toBase58() ?? "unknown";
        const winBid = formatSOL(freshAuction.currentBid.toNumber());
        const content = `Auction settled! NFT ${truncateAddress(freshAuction.nftMint.toBase58())} sold for ${winBid} SOL to ${truncateAddress(winnerAddr)}. Going, going, onchain.`;

        getProfile(publicKey.toBase58())
          .then((profile) => {
            if (profile?.profile.id) {
              return createContent(profile.profile.id, content, {
                auctionId: id,
                type: "auction_settled",
                nftMint: freshAuction.nftMint.toBase58(),
                winner: winnerAddr,
                amount: freshAuction.currentBid.toString(),
              });
            }
          })
          .catch(() => {});
      }

      // Mint badges (best-effort — never blocks settlement success)
      try {
        setProgressLabel("Minting badges...");
        const auctionPubkey = new PublicKey(id);
        const bidders = await getAuctionBidders(l1Connection, auctionPubkey);
        const winnerAddr = auction.highestBidder?.toBase58() ?? null;
        const auctionName = nftMetadata?.name ?? truncateAddress(auction.nftMint.toBase58());
        const winBidStr = formatSOL(auction.currentBid.toNumber());

        const recipients = bidders.map((bidder) => {
          const addr = bidder.toBase58();
          const isVictor = addr === winnerAddr;
          return {
            address: addr,
            badgeType: isVictor ? ("victor" as const) : ("contender" as const),
            auctionName,
            auctionId: id,
            ...(isVictor ? { winningBid: `${winBidStr} SOL` } : {}),
          };
        });

        if (recipients.length > 0) {
          const res = await fetch("/api/badges/mint", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ recipients }),
          });
          if (res.ok) {
            const data = await res.json();
            const minted = data.results?.filter((r: { success: boolean }) => r.success).length ?? 0;
            if (minted > 0) {
              addToast(`Minted ${minted} badge${minted > 1 ? "s" : ""}!`, "success");
            }
          }
        }
      } catch (badgeErr) {
        console.error("Badge minting failed (non-critical):", badgeErr);
        addToast("Badge minting failed — you can retry later", "error");
      }
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, "Settlement failed");
      console.error("Settlement error:", err);
      addToast(msg, "error");
      // If settle failed while auction is still delegated, show emergency refund option
      if (isDelegated) {
        setSettleFailed(true);
      }
    } finally {
      setActionLoading(false);
      setProgressLabel(null);
    }
  }, [auction, actions, id, addToast, refetch, refetchDeposit, publicKey, timerExpired, l1Connection, nftMetadata]);

  // -------------------------------------------------------------------------
  // Claim refund
  // -------------------------------------------------------------------------
  const handleClaimRefund = useCallback(async () => {
    if (!auction || !publicKey) return;
    setActionLoading(true);
    try {
      const refundSig = await actions.claimRefund(new PublicKey(id));
      addToast("Refund claimed!", "success", explorerUrl(refundSig));
      await Promise.all([refetch(), refetchDeposit()]);
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, "Refund failed");
      // Deposit PDA may already be closed (refunded by seller via "Refund All")
      if (msg.includes("NothingToRefund") || msg.includes("not found") || msg.includes("AccountNotFound") || msg.includes("0xbc4")) {
        addToast("Your deposit was already refunded!", "success");
      } else {
        addToast(msg, "error");
      }
      // Refresh state either way so UI reflects current on-chain state
      await Promise.all([refetch(), refetchDeposit()]).catch(() => {});
    } finally {
      setActionLoading(false);
    }
  }, [auction, actions, id, addToast, refetch, refetchDeposit, publicKey]);

  // -------------------------------------------------------------------------
  // Emergency refund (stuck delegation — auction state owned by delegation program)
  // -------------------------------------------------------------------------
  const handleEmergencyRefund = useCallback(async () => {
    if (!publicKey) return;
    setActionLoading(true);
    try {
      const sig = await actions.emergencyRefund(new PublicKey(id));
      addToast("Emergency refund successful!", "success", explorerUrl(sig));
      await Promise.all([refetch(), refetchDeposit()]).catch(() => {});
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, "Emergency refund failed");
      addToast(msg, "error");
    } finally {
      setActionLoading(false);
    }
  }, [actions, id, addToast, refetch, refetchDeposit, publicKey]);

  // -------------------------------------------------------------------------
  // Cancel auction (seller only, Created status)
  // -------------------------------------------------------------------------
  const handleCancel = useCallback(async () => {
    if (!auction || !publicKey) return;
    setActionLoading(true);
    try {
      const cancelSig = await actions.cancelAuction(new PublicKey(id), auction.nftMint);
      addToast("Auction cancelled — NFT returned", "success", explorerUrl(cancelSig));
      await refetch();
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, "Cancel failed");
      addToast(msg, "error");
    } finally {
      setActionLoading(false);
    }
  }, [auction, actions, id, addToast, refetch, publicKey]);

  // -------------------------------------------------------------------------
  // Close auction (seller only, reclaim rent)
  // -------------------------------------------------------------------------
  const handleClose = useCallback(async () => {
    if (!auction || !publicKey) return;
    setActionLoading(true);
    try {
      const closeSig = await actions.closeAuction(new PublicKey(id), auction.nftMint);
      addToast("Auction closed — rent reclaimed!", "success", explorerUrl(closeSig));
      await refetch();
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, "Close failed");
      if (msg.includes("OutstandingDeposits") || msg.includes("outstanding")) {
        addToast("Cannot close — bidders still have unclaimed deposits. Use 'Refund All Bidders' first.", "error");
      } else {
        addToast(msg, "error");
      }
    } finally {
      setActionLoading(false);
    }
  }, [auction, actions, id, addToast, refetch, publicKey]);

  // -------------------------------------------------------------------------
  // Refund all bidders (seller triggers permissionless refunds)
  // -------------------------------------------------------------------------
  const [refundProgress, setRefundProgress] = useState<string | null>(null);
  const [allRefunded, setAllRefunded] = useState(false);
  const handleRefundAll = useCallback(async () => {
    if (!auction || !publicKey) return;
    setActionLoading(true);
    setRefundProgress(null);
    try {
      const auctionPubkey = new PublicKey(id);
      const bidders = await getAuctionBidders(l1Connection, auctionPubkey);

      // Include ALL bidders (including winner — they may have excess deposit after settlement)
      const activeBidders: PublicKey[] = [];
      for (const bidder of bidders) {
        const [depositPDA] = getDepositPDA(auctionPubkey, bidder);
        const info = await l1Connection.getAccountInfo(depositPDA);
        if (info) activeBidders.push(bidder);
      }

      if (activeBidders.length === 0) {
        addToast("No outstanding deposits to refund", "success");
        setAllRefunded(true);
        return;
      }

      let refunded = 0;
      for (const bidder of activeBidders) {
        setRefundProgress(`Refunding ${refunded + 1}/${activeBidders.length}...`);
        try {
          const sig = await actions.claimRefundFor(auctionPubkey, bidder);
          refunded++;
          addToast(
            `Refunded ${truncateAddress(bidder.toBase58())}`,
            "success",
            explorerUrl(sig)
          );
        } catch (err: unknown) {
          const msg = extractErrorMessage(err, "Refund failed");
          // Skip NothingToRefund errors (already zeroed)
          if (!msg.includes("NothingToRefund")) {
            addToast(`Failed to refund ${truncateAddress(bidder.toBase58())}: ${msg}`, "error");
          }
        }
        // Small delay to avoid rate limits
        if (refunded < activeBidders.length) {
          await new Promise((r) => setTimeout(r, 200));
        }
      }

      addToast(`All refunds complete (${refunded}/${activeBidders.length})`, "success");
      setAllRefunded(true);
      await refetch();
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, "Refund all failed");
      addToast(msg, "error");
    } finally {
      setActionLoading(false);
      setRefundProgress(null);
    }
  }, [auction, actions, id, addToast, refetch, publicKey, l1Connection]);

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-6 pt-8 pb-24">
        <div className="mb-6 h-4 w-32 animate-shimmer rounded" />
        <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
          {/* Left: artwork skeleton */}
          <div className="flex-1 lg:max-w-[60%]">
            <div className="aspect-square w-full animate-shimmer rounded-xl" />
            <div className="mt-4 h-8 w-48 animate-shimmer rounded" />
            <div className="mt-6 space-y-3 border-t border-charcoal-light pt-6">
              <div className="h-10 w-full animate-shimmer rounded" />
              <div className="h-4 w-3/4 animate-shimmer rounded" />
            </div>
          </div>
          {/* Right: control panel skeleton */}
          <div className="flex flex-col gap-6 lg:w-[40%]">
            <div className="h-8 w-24 animate-shimmer rounded-full" />
            <div className="h-24 w-full animate-shimmer rounded-lg" />
            <div className="h-20 w-full animate-shimmer rounded-lg" />
            <div className="h-40 w-full animate-shimmer rounded-lg" />
          </div>
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
              "This auction may not exist or the account may not be initialized yet."}
          </p>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => refetch()}
              className="rounded-md border border-gold/30 px-4 py-2 text-xs font-medium tracking-[0.1em] text-gold uppercase transition-all hover:border-gold hover:bg-gold/5"
            >
              Retry
            </button>
            <a
              href="/"
              className="rounded-md border border-cream/10 px-4 py-2 text-xs font-medium tracking-[0.1em] text-cream/40 uppercase transition-all hover:border-cream/20 hover:text-cream/60"
            >
              Back to Discover
            </a>
          </div>
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
      <div className="fixed right-6 bottom-20 z-50 flex flex-col gap-2 sm:bottom-6">
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
        {/* Back link */}
        <a
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-xs text-cream/30 transition-colors hover:text-cream/60"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Discover
        </a>

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
            <div className="relative aspect-square w-full overflow-hidden rounded-xl">
              <NftImage
                mintAddress={auction.nftMint.toBase58()}
                className="absolute inset-0 h-full w-full rounded-xl"
              />
            </div>

            {/* NFT Title */}
            <NftTitle mintAddress={auction.nftMint.toBase58()} />

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
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 animate-er-glow"
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

            {/* ER health warning */}
            {erHealthy === false && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-300">
                <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                Ephemeral Rollup unavailable — bids will confirm at L1 speed (~400ms)
              </div>
            )}

            {/* Countdown timer */}
            <div className="flex justify-center rounded-lg border border-charcoal-light bg-charcoal px-6 py-6">
              <CountdownTimer
                endTime={auction.endTime.toNumber()}
                status={statusLabel?.toLowerCase() ?? "created"}
                clockOffset={clockOffset}
              />
            </div>

            {/* Current bid display — with flash animation */}
            <div
              role="status"
              aria-live="polite"
              aria-label="Current bid amount"
              className={`flex flex-col items-center rounded-lg border border-charcoal-light bg-charcoal px-6 py-5 transition-all duration-300 ${
                bidFlash ? "border-gold/60 shadow-[0_0_40px_rgba(198,169,97,0.25)] animate-bid-flash" : ""
              }`}
            >
              <span className="mb-1 text-[10px] tracking-[0.25em] text-cream/40 uppercase">
                {auction.currentBid.toNumber() > 0
                  ? "Current Bid"
                  : "Reserve Price"}
              </span>
              <div className="flex items-baseline gap-2">
                <motion.span
                  key={auction.currentBid.toString()}
                  initial={prevBid !== null ? { scale: 1.25, color: "#D4B872" } : false}
                  animate={{ scale: 1, color: "#C6A961" }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                  className="text-4xl font-bold tabular-nums text-gold"
                >
                  {auction.currentBid.toNumber() > 0
                    ? formatSOL(auction.currentBid.toNumber())
                    : formatSOL(auction.reservePrice.toNumber())}
                </motion.span>
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

            {/* Winner announcement */}
            {isSettled && auction.highestBidder && auction.currentBid.toNumber() > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="relative overflow-hidden rounded-lg border border-gold/40 bg-gradient-to-b from-gold/10 to-transparent p-6 text-center"
              >
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(198,169,97,0.08),transparent_70%)]" />
                <p className="relative mb-1 text-[10px] tracking-[0.3em] text-gold/60 uppercase">
                  Sold
                </p>
                <p className="relative font-serif text-2xl font-semibold italic text-gold">
                  {formatSOL(auction.currentBid.toNumber())} SOL
                </p>
                <div className="relative mt-3 flex items-center justify-center gap-1.5">
                  <span className="text-xs text-cream/40">Won by</span>
                  <BidderName wallet={auction.highestBidder.toBase58()} />
                </div>
                {isWinner && (
                  <p className="relative mt-3 text-xs font-medium text-gold/80">
                    Congratulations, you won!
                  </p>
                )}
              </motion.div>
            )}

            {/* Bid Panel — unified deposit+bid flow (during Active, timer not expired) */}
            {isActive && !isSeller && !timerExpired && (
              <BidPanel
                id="bid-panel"
                auctionState={{
                  currentBid: auction.currentBid.toNumber(),
                  highestBidder: auction.highestBidder?.toBase58() ?? null,
                  status: auction.status,
                  reservePrice: auction.reservePrice.toNumber(),
                  minBidIncrement: auction.minBidIncrement.toNumber(),
                }}
                onBid={handleBid}
                userDeposit={userDeposit}
                isLoading={actionLoading}
                isSeller={false}
                progressLabel={progressLabel}
                sessionActive={session.sessionActive}
                onEnableSession={handleEnableSession}
                sessionActivating={session.activating}
                sessionActivationProgress={session.activationProgress}
                onTopUpDeposit={handleTopUpDeposit}
              />
            )}

            {/* Seller cannot bid message during active (only while timer running) */}
            {isActive && isSeller && !timerExpired && (
              <div className="rounded-lg border border-charcoal-light bg-charcoal p-5">
                <p className="text-center text-xs text-cream/40">
                  You are the seller — you cannot bid on your own auction.
                </p>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-col gap-3">
              {/* Created + seller: Go Live (Start + Delegate in one click) */}
              {isCreated && isSeller && (
                <div className="flex flex-col gap-2">
                  <button
                    onClick={handleGoLive}
                    disabled={actionLoading}
                    className="flex h-12 w-full items-center justify-center rounded-md bg-gold text-sm font-semibold tracking-[0.15em] text-jet uppercase transition-all duration-200 hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {actionLoading ? (
                      <div className="flex items-center gap-2">
                        <Spinner />
                        {progressLabel && (
                          <span className="text-sm font-semibold normal-case tracking-normal">
                            {progressLabel}
                          </span>
                        )}
                      </div>
                    ) : (
                      "Go Live"
                    )}
                  </button>
                  <p className="text-center text-[10px] text-cream/25">
                    Starts the auction and delegates to Ephemeral Rollup for sub-50ms bidding
                  </p>
                </div>
              )}

              {/* Active + seller + not delegated: just delegate (start already happened) */}
              {isActive && isSeller && isDelegated === false && (
                <div className="flex flex-col gap-2">
                  <button
                    onClick={handleGoLive}
                    disabled={actionLoading}
                    className="flex h-12 w-full items-center justify-center rounded-md bg-emerald-600 text-sm font-semibold tracking-[0.15em] text-white uppercase transition-all duration-200 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {actionLoading ? (
                      <div className="flex items-center gap-2">
                        <Spinner />
                        {progressLabel && (
                          <span className="text-sm font-semibold normal-case tracking-normal">
                            {progressLabel}
                          </span>
                        )}
                      </div>
                    ) : (
                      "Go Live on ER"
                    )}
                  </button>
                  <p className="text-center text-[10px] text-cream/25">
                    Delegates to Ephemeral Rollup for sub-50ms bidding
                  </p>
                </div>
              )}

              {/* Created + not seller: prompt to deposit for upcoming auction */}
              {isCreated && !isSeller && (
                <div className="rounded-lg border border-charcoal-light bg-charcoal p-5">
                  <p className="text-center text-xs text-cream/40">
                    This auction hasn&apos;t started yet. You can deposit SOL ahead of time to be ready when bidding opens.
                  </p>
                  <BidPanel
                    auctionState={{
                      currentBid: 0,
                      highestBidder: null,
                      status: auction.status,
                      reservePrice: auction.reservePrice.toNumber(),
                      minBidIncrement: auction.minBidIncrement.toNumber(),
                    }}
                    onBid={async (lamports) => {
                      // Pre-auction: just deposit, don't bid
                      setActionLoading(true);
                      setProgressLabel("Depositing SOL...");
                      try {
                        const depSig = await actions.deposit(new PublicKey(id), new BN(lamports));
                        addToast(`Deposited ${formatSOL(lamports)} SOL`, "success", explorerUrl(depSig));
                        await refetchDeposit();
                      } catch (err: unknown) {
                        const msg = extractErrorMessage(err, "Deposit failed");
                        addToast(msg, "error");
                      } finally {
                        setActionLoading(false);
                        setProgressLabel(null);
                      }
                    }}
                    userDeposit={userDeposit}
                    isLoading={actionLoading}
                    isSeller={false}
                    progressLabel={progressLabel}
                    depositOnly
                  />
                </div>
              )}

              {/* Ended or timer expired: Settle (handles end + undelegate + settle) */}
              {canSettle && (
                settleConfirm ? (
                  <div className="flex flex-col gap-2 rounded-lg border border-gold/30 bg-gold/5 p-4">
                    <p className="text-center text-xs text-cream/60">
                      This will end the auction, transfer the NFT to the winner, and distribute SOL. Continue?
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setSettleConfirm(false)}
                        disabled={actionLoading}
                        className="flex h-10 flex-1 items-center justify-center rounded-md border border-charcoal-light text-xs font-medium text-cream/50 transition-all hover:border-cream/30 hover:text-cream/70 disabled:opacity-40"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => { setSettleConfirm(false); handleSettle(); }}
                        disabled={actionLoading}
                        className="flex h-10 flex-1 items-center justify-center rounded-md bg-gold text-xs font-semibold tracking-[0.1em] text-jet uppercase transition-all hover:bg-gold-light disabled:opacity-40"
                      >
                        {actionLoading ? (
                          <div className="flex items-center gap-2">
                            <Spinner />
                            {progressLabel && (
                              <span className="text-xs font-medium normal-case tracking-normal">
                                {progressLabel}
                              </span>
                            )}
                          </div>
                        ) : (
                          "Confirm Settle"
                        )}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setSettleConfirm(true)}
                    disabled={actionLoading}
                    className="flex h-12 w-full items-center justify-center rounded-md bg-gold text-sm font-semibold tracking-[0.15em] text-jet uppercase transition-all duration-200 hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {actionLoading ? (
                      <div className="flex items-center gap-2">
                        <Spinner />
                        {progressLabel && (
                          <span className="text-sm font-semibold normal-case tracking-normal">
                            {progressLabel}
                          </span>
                        )}
                      </div>
                    ) : (
                      "Settle Auction"
                    )}
                  </button>
                )
              )}

              {/* Settled or Cancelled or Ended: Claim Refund (not for winner — their deposit was used) */}
              {(isSettled || isCancelled || isEnded) && !isWinner && userDeposit != null && userDeposit > 0 && (
                <button
                  onClick={handleClaimRefund}
                  disabled={actionLoading}
                  aria-label={`Claim refund of ${formatSOL(userDeposit)} SOL`}
                  className="flex h-12 w-full items-center justify-center rounded-md border border-gold/40 text-sm font-medium tracking-[0.15em] text-gold uppercase transition-all duration-200 hover:border-gold hover:bg-gold/5 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {actionLoading ? <Spinner /> : "Claim Refund"}
                </button>
              )}

              {/* Emergency refund — only after settle has failed on a delegated auction */}
              {settleFailed && userDeposit != null && userDeposit > 0 && publicKey && (
                <button
                  onClick={handleEmergencyRefund}
                  disabled={actionLoading}
                  aria-label={`Emergency refund of ${formatSOL(userDeposit)} SOL`}
                  className="flex h-12 w-full items-center justify-center rounded-md border border-amber-500/40 bg-amber-500/10 text-sm font-medium tracking-[0.15em] text-amber-400 uppercase transition-all duration-200 hover:border-amber-500 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {actionLoading ? <Spinner /> : `Emergency Refund (${formatSOL(userDeposit)} SOL)`}
                </button>
              )}

              {/* Refund already claimed/processed — informational banner for non-seller bidders */}
              {(isSettled || isCancelled) && !isSeller && !isWinner && wasRefunded && userDeposit == null && (
                <div className="rounded-md border border-green-500/20 bg-green-500/5 px-4 py-3 text-center text-sm text-green-400">
                  Your deposit has been refunded to your wallet.
                </div>
              )}

              {/* Cancel auction — seller only, Created status */}
              {isCreated && isSeller && (
                <button
                  onClick={handleCancel}
                  disabled={actionLoading}
                  className="flex h-10 w-full items-center justify-center rounded-md border border-red-500/30 text-xs font-medium tracking-[0.1em] text-red-400 uppercase transition-all hover:border-red-400 hover:bg-red-500/5 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {actionLoading ? <Spinner /> : "Cancel Auction"}
                </button>
              )}

              {/* Post-settlement seller actions — refund then close */}
              {(isSettled || isCancelled) && isSeller && (
                <div className="space-y-3 rounded-lg border border-charcoal-light bg-charcoal/50 p-4">
                  <p className="text-xs leading-relaxed text-cream/50">
                    <span className="font-semibold text-cream/70">Step 1:</span> Refund all losing bidders&apos; deposits.{" "}
                    <span className="font-semibold text-cream/70">Step 2:</span> Close the auction to reclaim account rent.
                  </p>
                  <button
                    onClick={handleRefundAll}
                    disabled={actionLoading || allRefunded}
                    className={`flex h-11 w-full items-center justify-center gap-2 rounded-md border text-xs font-medium tracking-[0.1em] uppercase transition-all disabled:cursor-not-allowed ${
                      allRefunded
                        ? "border-emerald-500/30 text-emerald-400/60"
                        : "border-gold/30 text-gold hover:border-gold hover:bg-gold/5 disabled:opacity-40"
                    }`}
                  >
                    {allRefunded ? (
                      <>
                        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                        All Bidders Refunded
                      </>
                    ) : actionLoading && refundProgress ? refundProgress : actionLoading ? <Spinner /> : "Step 1 — Refund All Bidders"}
                  </button>
                  <button
                    onClick={handleClose}
                    disabled={actionLoading}
                    className="flex h-10 w-full items-center justify-center rounded-md border border-cream/15 text-xs font-medium tracking-[0.1em] text-cream/40 uppercase transition-all hover:border-cream/30 hover:text-cream/60 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {actionLoading ? <Spinner /> : "Step 2 — Close Auction & Reclaim Rent"}
                  </button>
                </div>
              )}
            </div>

            {/* Bid History */}
            <div className="rounded-lg border border-charcoal-light bg-charcoal p-5">
              {lastBidSpeedMs !== null && (
                <div className="mb-3 flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5">
                  <span className="text-[10px] font-semibold tracking-wide text-emerald-400 uppercase">
                    Last bid: {lastBidSpeedMs}ms
                  </span>
                  <span className="text-[10px] text-emerald-400/50">
                    via Ephemeral Rollup
                  </span>
                </div>
              )}
              <BidHistory bids={bidHistory} />
            </div>

            {/* Comments + Like */}
            <CommentSection
              auctionId={id}
              headerRight={
                <LikeButton auctionId={id} userProfileId={myProfileId} />
              }
            />
          </motion.div>
        </div>
      </motion.div>

      {/* Mobile sticky bid bar — visible only on small screens during active auction */}
      {isActive && !isSeller && !timerExpired && publicKey && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-charcoal-light bg-jet/95 px-4 py-3 backdrop-blur-sm lg:hidden">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col">
              <span className="text-[10px] tracking-[0.15em] text-cream/40 uppercase">
                {auction.currentBid.toNumber() > 0 ? "Current bid" : "Reserve"}
              </span>
              <span className="text-lg font-bold tabular-nums text-gold">
                {auction.currentBid.toNumber() > 0
                  ? formatSOL(auction.currentBid.toNumber())
                  : formatSOL(auction.reservePrice.toNumber())}{" "}
                <span className="text-xs font-medium text-gold/50">SOL</span>
              </span>
            </div>
            <button
              onClick={() => document.getElementById("bid-panel")?.scrollIntoView({ behavior: "smooth", block: "center" })}
              className="rounded-md bg-gold px-6 py-2.5 text-sm font-semibold tracking-[0.1em] text-jet uppercase transition-all hover:bg-gold-light"
            >
              Place Bid
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NftTitle — resolves NFT name from metadata
// ---------------------------------------------------------------------------

function NftTitle({ mintAddress }: { mintAddress: string }) {
  const { metadata } = useNftMetadata(mintAddress);
  if (!metadata?.name) return null;

  return (
    <h1 className="mt-4 font-serif text-2xl font-semibold italic text-cream sm:text-3xl">
      {metadata.name}
    </h1>
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
