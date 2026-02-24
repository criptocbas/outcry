"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export default function Header() {
  const { publicKey } = useWallet();
  const [scrolled, setScrolled] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close mobile nav on route change (link click)
  const closeMobile = () => setMobileOpen(false);

  return (
    <motion.header
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className={`fixed top-0 left-0 right-0 z-50 border-b transition-all duration-300 ${
        scrolled
          ? "border-[#C6A961]/40 bg-[#050505]/80 backdrop-blur-xl"
          : "border-[#C6A961]/20 bg-[#050505]/95"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        {/* Left: Logotype */}
        <Link href="/" className="flex flex-col items-start leading-none">
          <span
            className="text-2xl font-bold italic text-[#C6A961]"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            OUTCRY
          </span>
          <span
            className="text-[9px] tracking-[0.3em] text-[#F5F0E8]/50 uppercase"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
          >
            Live Auctions
          </span>
        </Link>

        {/* Center: Desktop Nav */}
        <nav className="hidden items-center gap-2 sm:flex">
          <NavLink href="/#auctions">Discover</NavLink>
          <NavSlash />
          <NavLink href="/auction/create">Create</NavLink>
          {publicKey && (
            <>
              <NavSlash />
              <NavLink href={`/profile/${publicKey.toBase58()}`}>
                Profile
              </NavLink>
            </>
          )}
        </nav>

        {/* Right: Wallet + Hamburger */}
        <div className="flex items-center gap-3">
          {mounted && (
            <WalletMultiButton
              style={{
                backgroundColor: "transparent",
                border: "1px solid rgba(198,169,97,0.4)",
                borderRadius: "6px",
                color: "#C6A961",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: "13px",
                fontWeight: 500,
                height: "36px",
                letterSpacing: "0.05em",
                padding: "0 16px",
                textTransform: "uppercase",
                transition: "all 0.2s ease",
              }}
            />
          )}

          {/* Hamburger — mobile only */}
          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-[#C6A961]/30 text-[#C6A961] transition-colors hover:bg-[#C6A961]/10 sm:hidden"
            aria-label="Toggle menu"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              {mobileOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.nav
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden border-t border-[#C6A961]/10 bg-[#050505]/95 backdrop-blur-xl sm:hidden"
          >
            <div className="flex flex-col gap-1 px-6 py-4">
              <MobileNavLink href="/#auctions" onClick={closeMobile}>Discover</MobileNavLink>
              <MobileNavLink href="/auction/create" onClick={closeMobile}>Create</MobileNavLink>
              {publicKey && (
                <MobileNavLink href={`/profile/${publicKey.toBase58()}`} onClick={closeMobile}>
                  Profile
                </MobileNavLink>
              )}
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </motion.header>
  );
}

function NavSlash() {
  return (
    <span className="text-[10px] text-[#C6A961]/40 select-none">/</span>
  );
}

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="text-xs tracking-[0.15em] text-[#F5F0E8]/70 uppercase transition-colors duration-200 hover:text-[#C6A961]"
      style={{ fontFamily: "'DM Sans', sans-serif" }}
    >
      {children}
    </Link>
  );
}

function MobileNavLink({
  href,
  onClick,
  children,
}: {
  href: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="rounded-md px-3 py-2.5 text-sm tracking-[0.1em] text-[#F5F0E8]/70 uppercase transition-colors duration-200 hover:bg-[#C6A961]/10 hover:text-[#C6A961]"
      style={{ fontFamily: "'DM Sans', sans-serif" }}
    >
      {children}
    </Link>
  );
}
