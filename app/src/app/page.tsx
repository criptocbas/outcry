"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useAuctions } from "@/hooks/useAuctions";
import AuctionCard from "@/components/auction/AuctionCard";

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.08,
    },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: "easeOut" as const },
  },
};

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: (delay: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: "easeOut" as const, delay },
  }),
};

// ---------------------------------------------------------------------------
// Skeleton Card
// ---------------------------------------------------------------------------

function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-lg border border-charcoal-light bg-charcoal">
      <div className="aspect-square w-full animate-shimmer" />
      <div className="space-y-3 px-4 pt-3 pb-4">
        <div className="h-3 w-16 rounded animate-shimmer" />
        <div className="h-6 w-24 rounded animate-shimmer" />
        <div className="h-px bg-charcoal-light" />
        <div className="h-4 w-full rounded animate-shimmer" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HomePage() {
  const { auctions, loading, error } = useAuctions();

  return (
    <div className="min-h-screen">
      {/* ---------------------------------------------------------------- */}
      {/* Hero                                                             */}
      {/* ---------------------------------------------------------------- */}
      <section className="relative flex flex-col items-center justify-center px-6 pt-24 pb-20 text-center sm:pt-32 sm:pb-28">
        {/* Subtle radial gradient background */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 50% 30%, rgba(198,169,97,0.06) 0%, transparent 70%)",
          }}
        />

        <motion.h1
          custom={0}
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          className="relative font-serif text-5xl font-bold leading-tight tracking-tight sm:text-7xl md:text-8xl"
        >
          <span className="italic text-gold">Going, going,</span>
          <br />
          <span className="italic text-gold">onchain.</span>
        </motion.h1>

        <motion.p
          custom={0.15}
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          className="relative mt-6 max-w-lg text-base leading-relaxed text-cream/50 sm:text-lg"
        >
          Real-time live auctions on Solana. Every bid confirms in under 50
          milliseconds.
        </motion.p>

        {/* CTA buttons */}
        <motion.div
          custom={0.3}
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          className="relative mt-10 flex flex-col items-center gap-4 sm:flex-row"
        >
          <Link
            href="#auctions"
            className="flex h-12 items-center justify-center rounded-md bg-gold px-8 text-sm font-semibold tracking-[0.15em] text-jet uppercase transition-all duration-200 hover:bg-gold-light"
          >
            Explore Auctions
          </Link>
          <Link
            href="/auction/create"
            className="flex h-12 items-center justify-center rounded-md border border-gold/40 px-8 text-sm font-medium tracking-[0.15em] text-gold uppercase transition-all duration-200 hover:border-gold hover:bg-gold/5"
          >
            Create Auction
          </Link>
        </motion.div>

        {/* Decorative divider: thin line with diamond */}
        <motion.div
          custom={0.45}
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          className="relative mt-16 flex w-full max-w-md flex-col items-center gap-4"
        >
          <div className="flex w-full items-center">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent to-gold/30" />
            <div className="mx-4 h-2 w-2 rotate-45 border border-gold/40 bg-transparent" />
            <div className="h-px flex-1 bg-gradient-to-l from-transparent to-gold/30" />
          </div>
          {/* Scroll hint chevron */}
          <a href="#auctions" className="animate-scroll-hint" aria-label="Scroll to auctions">
            <svg className="h-5 w-5 text-gold/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </a>
        </motion.div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Auctions Grid                                                    */}
      {/* ---------------------------------------------------------------- */}
      <section id="auctions" className="mx-auto max-w-7xl px-6 pb-24">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="mb-10 flex items-center gap-4"
        >
          <div className="h-px w-8 bg-gold" />
          <h2 className="text-xs font-medium tracking-[0.3em] text-cream/60 uppercase">
            Discover
          </h2>
        </motion.div>

        {/* Error state */}
        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-6 py-4 text-center text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && auctions.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="flex flex-col items-center justify-center py-24"
          >
            <svg className="mb-4 h-12 w-12 text-cream/10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V4.5a1.5 1.5 0 00-1.5-1.5H3.75a1.5 1.5 0 00-1.5 1.5v15a1.5 1.5 0 001.5 1.5z" />
            </svg>
            <p className="font-serif text-xl italic text-cream/30">
              No auctions yet
            </p>
            <p className="mt-2 max-w-xs text-center text-sm text-cream/20">
              Be the first to list your artwork and let collectors compete in real-time.
            </p>
            <Link
              href="/auction/create"
              className="mt-6 flex h-10 items-center justify-center rounded-md border border-gold/40 px-6 text-xs font-semibold tracking-[0.15em] text-gold uppercase transition-all duration-200 hover:border-gold hover:bg-gold/5"
            >
              Create an Auction
            </Link>
          </motion.div>
        )}

        {/* Auctions grid */}
        {!loading && auctions.length > 0 && (
          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-40px" }}
            className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
          >
            {auctions.map((item) => {
              return (
                <motion.div key={item.publicKey.toBase58()} variants={cardVariants}>
                  <AuctionCard
                    auction={{
                      publicKey: item.publicKey.toBase58(),
                      seller: item.account.seller.toBase58(),
                      nftMint: item.account.nftMint.toBase58(),
                      currentBid: item.account.currentBid.toNumber(),
                      endTime: item.account.endTime.toNumber(),
                      bidCount: item.account.bidCount,
                      status: item.account.status,
                      reservePrice: item.account.reservePrice.toNumber(),
                    }}
                  />
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </section>
    </div>
  );
}
