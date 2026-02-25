"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAnchorWallet } from "@solana/wallet-adapter-react";
import { Connection, PublicKey } from "@solana/web3.js";
import { getProgram, getReadOnlyProgram, getDepositPDA } from "@/lib/program";
import { DEVNET_RPC } from "@/lib/constants";
import type BN from "bn.js";

export interface BidderDepositAccount {
  auction: PublicKey;
  bidder: PublicKey;
  amount: BN;
  bump: number;
}

export interface UseBidderDepositReturn {
  deposit: BidderDepositAccount | null;
  loading: boolean;
  refetch: () => Promise<void>;
}

/**
 * Fetches the user's BidderDeposit PDA for a given auction.
 * Uses standard devnet connection since BidderDeposit is never delegated.
 */
export function useBidderDeposit(
  auctionPublicKey: string | null,
  bidderPublicKey: string | null
): UseBidderDepositReturn {
  const connection = useMemo(() => new Connection(DEVNET_RPC, "confirmed"), []);
  const wallet = useAnchorWallet();

  const [deposit, setDeposit] = useState<BidderDepositAccount | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchDeposit = useCallback(async () => {
    if (!auctionPublicKey || !bidderPublicKey) {
      setDeposit(null);
      return;
    }

    setLoading(true);
    try {
      const program = wallet ? getProgram(connection, wallet) : getReadOnlyProgram(connection);
      const auctionPk = new PublicKey(auctionPublicKey);
      const bidderPk = new PublicKey(bidderPublicKey);
      const [depositPda] = getDepositPDA(auctionPk, bidderPk);

      const account = await (
        program.account as Record<string, { fetch: (key: PublicKey) => Promise<unknown> }>
      )["bidderDeposit"].fetch(depositPda);
      setDeposit(account as unknown as BidderDepositAccount);
    } catch {
      // Account doesn't exist yet — no deposit made
      setDeposit(null);
    } finally {
      setLoading(false);
    }
  }, [auctionPublicKey, bidderPublicKey, wallet, connection]);

  useEffect(() => {
    let stale = false;

    (async () => {
      if (!auctionPublicKey || !bidderPublicKey) {
        setDeposit(null);
        return;
      }

      setLoading(true);
      try {
        const program = wallet ? getProgram(connection, wallet) : getReadOnlyProgram(connection);
        const auctionPk = new PublicKey(auctionPublicKey);
        const bidderPk = new PublicKey(bidderPublicKey);
        const [depositPda] = getDepositPDA(auctionPk, bidderPk);

        const account = await (
          program.account as Record<string, { fetch: (key: PublicKey) => Promise<unknown> }>
        )["bidderDeposit"].fetch(depositPda);
        if (!stale) setDeposit(account as unknown as BidderDepositAccount);
      } catch {
        if (!stale) setDeposit(null);
      } finally {
        if (!stale) setLoading(false);
      }
    })();

    return () => { stale = true; };
  }, [auctionPublicKey, bidderPublicKey, wallet, connection]);

  return { deposit, loading, refetch: fetchDeposit };
}
