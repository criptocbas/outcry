"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import BN from "bn.js";
import {
  LAMPORTS_PER_SOL,
  DEFAULT_EXTENSION_SECONDS,
  DEFAULT_EXTENSION_WINDOW,
} from "@/lib/constants";
import { useAuctionActions } from "@/hooks/useAuctionActions";
import { getAuctionPDA } from "@/lib/program";
import { useNftMetadata } from "@/hooks/useNftMetadata";
import NftImage from "@/components/auction/NftImage";
import Spinner from "@/components/ui/Spinner";

// ---------------------------------------------------------------------------
// Duration options
// ---------------------------------------------------------------------------

const DURATION_OPTIONS = [
  { label: "5 minutes", value: 300 },
  { label: "15 minutes", value: 900 },
  { label: "1 hour", value: 3600 },
  { label: "6 hours", value: 21600 },
  { label: "1 day", value: 86400 },
  { label: "3 days", value: 259200 },
  { label: "7 days", value: 604800 },
];

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (delay: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: "easeOut" as const, delay },
  }),
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CreateAuctionPage() {
  const { createAuction, ready } = useAuctionActions();
  const { publicKey } = useWallet();

  const [nftMint, setNftMint] = useState("");
  const [reservePrice, setReservePrice] = useState("1.00");
  const [duration, setDuration] = useState(3600);
  const [minBidIncrement, setMinBidIncrement] = useState("0.1");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successKey, setSuccessKey] = useState<string | null>(null);
  const [auctionAddress, setAuctionAddress] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessKey(null);

    // Validate mint address
    let mintPubkey: PublicKey;
    try {
      mintPubkey = new PublicKey(nftMint.trim());
    } catch {
      setError("Invalid NFT mint address.");
      return;
    }

    const reservePriceLamports = Math.floor(
      parseFloat(reservePrice) * LAMPORTS_PER_SOL
    );
    if (isNaN(reservePriceLamports) || reservePriceLamports < 0.01 * LAMPORTS_PER_SOL) {
      setError("Reserve price must be at least 0.01 SOL.");
      return;
    }

    const incrementLamports = Math.floor(
      parseFloat(minBidIncrement) * LAMPORTS_PER_SOL
    );
    if (isNaN(incrementLamports) || incrementLamports <= 0) {
      setError("Bid increment must be greater than 0.");
      return;
    }

    setIsLoading(true);

    try {
      const sig = await createAuction({
        nftMint: mintPubkey,
        reservePrice: new BN(reservePriceLamports),
        durationSeconds: new BN(duration),
        extensionSeconds: DEFAULT_EXTENSION_SECONDS,
        extensionWindow: DEFAULT_EXTENSION_WINDOW,
        minBidIncrement: new BN(incrementLamports),
      });

      setSuccessKey(sig);
      // Derive the auction PDA so we can link directly to it
      if (publicKey) {
        const [auctionPDA] = getAuctionPDA(publicKey, mintPubkey);
        setAuctionAddress(auctionPDA.toBase58());
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to create auction";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Success state
  // ---------------------------------------------------------------------------
  if (successKey) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="flex w-full max-w-md flex-col items-center gap-6 rounded-xl border border-gold/20 bg-charcoal p-10 text-center"
        >
          {/* Gold checkmark circle */}
          <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-gold/40 bg-gold/10">
            <svg
              className="h-8 w-8 text-gold"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>

          <h2 className="font-serif text-2xl font-semibold italic text-cream">
            Auction Created
          </h2>
          <p className="text-sm leading-relaxed text-cream/40">
            Your auction has been created on Solana. Share it with collectors or
            start it when you are ready.
          </p>

          <div className="w-full rounded-md border border-charcoal-light bg-jet px-4 py-3">
            <span className="text-[10px] tracking-[0.2em] text-cream/30 uppercase">
              Transaction
            </span>
            <p className="mt-1 break-all font-mono text-xs text-cream/50">
              {successKey}
            </p>
          </div>

          <div className="flex w-full flex-col gap-3">
            {auctionAddress && (
              <Link
                href={`/auction/${auctionAddress}`}
                className="flex h-11 w-full items-center justify-center rounded-md bg-gold text-sm font-semibold tracking-[0.15em] text-jet uppercase transition-all duration-200 hover:bg-gold-light"
              >
                Go to Auction
              </Link>
            )}
            <Link
              href="/"
              className={`flex h-11 w-full items-center justify-center rounded-md text-sm font-medium tracking-[0.15em] uppercase transition-all duration-200 ${
                auctionAddress
                  ? "border border-gold/30 text-gold hover:border-gold hover:bg-gold/5"
                  : "bg-gold text-jet hover:bg-gold-light"
              }`}
            >
              View All Auctions
            </Link>
            <button
              onClick={() => {
                setSuccessKey(null);
                setAuctionAddress(null);
                setNftMint("");
                setReservePrice("1.00");
                setDuration(3600);
                setMinBidIncrement("0.1");
              }}
              className="flex h-11 w-full items-center justify-center rounded-md border border-cream/10 text-sm font-medium tracking-[0.15em] text-cream/40 uppercase transition-all duration-200 hover:border-cream/20 hover:text-cream/60"
            >
              Create Another
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------------
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6 py-12">
      {/* Subtle background glow */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(ellipse 50% 40% at 50% 20%, rgba(198,169,97,0.04) 0%, transparent 70%)",
        }}
      />

      <motion.form
        onSubmit={handleSubmit}
        custom={0}
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        className="relative z-10 w-full max-w-lg"
      >
        <div className="rounded-xl border border-[#333] bg-charcoal p-8 sm:p-10">
          {/* Heading */}
          <motion.h1
            custom={0.05}
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="mb-2 font-serif text-3xl font-semibold italic text-cream sm:text-4xl"
          >
            List Your Artwork
          </motion.h1>
          <motion.p
            custom={0.1}
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="mb-8 text-sm text-cream/40"
          >
            Create an onchain auction for your NFT. Collectors will compete in
            real-time.
          </motion.p>

          {/* Decorative line */}
          <div className="mb-8 h-px bg-gradient-to-r from-gold/30 via-gold/10 to-transparent" />

          {/* Error */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 rounded-md border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400"
            >
              {error}
            </motion.div>
          )}

          <div className="flex flex-col gap-6">
            {/* NFT Mint Address */}
            <motion.div
              custom={0.15}
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              className="flex flex-col gap-2"
            >
              <label htmlFor="nft-mint" className="text-[11px] font-medium tracking-[0.2em] text-cream/50 uppercase">
                NFT Mint Address
              </label>
              <input
                id="nft-mint"
                type="text"
                value={nftMint}
                onChange={(e) => setNftMint(e.target.value)}
                placeholder="e.g. 7xKXtg2CW87d97TXJSDp..."
                required
                className="w-full rounded-md border border-charcoal-light bg-jet px-4 py-3 text-sm text-cream placeholder-cream/20 focus-gold"
              />
              <p className="text-[11px] text-cream/25">
                Enter the mint address of your NFT
              </p>
              <NftPreview mintAddress={nftMint.trim()} />
            </motion.div>

            {/* Reserve Price */}
            <motion.div
              custom={0.2}
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              className="flex flex-col gap-2"
            >
              <label htmlFor="reserve-price" className="text-[11px] font-medium tracking-[0.2em] text-cream/50 uppercase">
                Reserve Price
              </label>
              <div className="relative">
                <input
                  id="reserve-price"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={reservePrice}
                  onChange={(e) => setReservePrice(e.target.value)}
                  required
                  className="w-full rounded-md border border-charcoal-light bg-jet px-4 py-3 pr-14 text-right text-sm tabular-nums text-cream placeholder-cream/20 focus-gold"
                />
                <span className="absolute top-1/2 right-4 -translate-y-1/2 text-xs text-cream/30 uppercase">
                  SOL
                </span>
              </div>
              <p className="text-[11px] text-cream/25">
                Minimum starting bid (at least 0.01 SOL)
              </p>
            </motion.div>

            {/* Duration */}
            <motion.div
              custom={0.25}
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              className="flex flex-col gap-2"
            >
              <label htmlFor="duration" className="text-[11px] font-medium tracking-[0.2em] text-cream/50 uppercase">
                Duration
              </label>
              <div className="relative">
                <select
                  id="duration"
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full appearance-none rounded-md border border-charcoal-light bg-jet px-4 py-3 text-sm text-cream focus-gold"
                >
                  {DURATION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {/* Custom dropdown arrow */}
                <svg
                  className="pointer-events-none absolute top-1/2 right-4 h-4 w-4 -translate-y-1/2 text-cream/30"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </div>
              <p className="text-[11px] text-cream/25">
                How long the auction runs after starting
              </p>
            </motion.div>

            {/* Min Bid Increment */}
            <motion.div
              custom={0.3}
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              className="flex flex-col gap-2"
            >
              <label htmlFor="min-bid-increment" className="text-[11px] font-medium tracking-[0.2em] text-cream/50 uppercase">
                Minimum Bid Increment
              </label>
              <div className="relative">
                <input
                  id="min-bid-increment"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={minBidIncrement}
                  onChange={(e) => setMinBidIncrement(e.target.value)}
                  required
                  className="w-full rounded-md border border-charcoal-light bg-jet px-4 py-3 pr-14 text-right text-sm tabular-nums text-cream placeholder-cream/20 focus-gold"
                />
                <span className="absolute top-1/2 right-4 -translate-y-1/2 text-xs text-cream/30 uppercase">
                  SOL
                </span>
              </div>
              <p className="text-[11px] text-cream/25">
                Each bid must exceed the previous by at least this amount
              </p>
            </motion.div>
          </div>

          {/* Divider */}
          <div className="my-8 h-px bg-charcoal-light" />

          {/* Submit */}
          <motion.div
            custom={0.35}
            variants={fadeUp}
            initial="hidden"
            animate="visible"
          >
            <button
              type="submit"
              disabled={isLoading || !ready}
              className="flex h-13 w-full items-center justify-center rounded-md bg-gold text-sm font-semibold tracking-[0.15em] text-jet uppercase transition-all duration-200 hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isLoading ? (
                <Spinner />
              ) : !ready ? (
                "Connect Wallet"
              ) : (
                "Create Auction"
              )}
            </button>
          </motion.div>

          {/* Protocol fee notice */}
          <p className="mt-4 text-center text-[10px] text-cream/20">
            A 2.5% protocol fee applies at settlement. Royalties are distributed
            per Metaplex metadata.
          </p>
        </div>
      </motion.form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NftPreview — shows NFT image + name when a valid mint is entered
// ---------------------------------------------------------------------------

function NftPreview({ mintAddress }: { mintAddress: string }) {
  // Only attempt fetch if it looks like a valid base58 pubkey (32-44 chars)
  const isValid = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mintAddress);
  const { metadata, loading } = useNftMetadata(isValid ? mintAddress : null);

  if (!isValid || (!loading && !metadata)) return null;

  if (loading) {
    return (
      <div className="mt-2 flex items-center gap-3 rounded-lg border border-charcoal-light bg-jet p-3">
        <div className="h-12 w-12 animate-shimmer rounded-md" />
        <div className="h-3 w-24 animate-shimmer rounded" />
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-3 rounded-lg border border-gold/20 bg-jet p-3">
      <div className="h-12 w-12 overflow-hidden rounded-md">
        <NftImage mintAddress={mintAddress} className="h-full w-full" />
      </div>
      <div className="flex flex-col">
        <span className="text-sm font-medium text-cream/80">{metadata?.name ?? "Unknown NFT"}</span>
        {metadata?.symbol && (
          <span className="text-[10px] text-cream/30 uppercase">{metadata.symbol}</span>
        )}
      </div>
    </div>
  );
}

