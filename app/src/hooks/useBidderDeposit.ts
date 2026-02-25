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
  /** True when the deposit PDA was closed (bidder was refunded or claimed). */
  wasRefunded: boolean;
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
  const [wasRefunded, setWasRefunded] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchDeposit = useCallback(async () => {
    if (!auctionPublicKey || !bidderPublicKey) {
      setDeposit(null);
      setWasRefunded(false);
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
      setWasRefunded(false);
    } catch {
      // Account doesn't exist — check if it ever did (was refunded/claimed)
      setDeposit(null);
      try {
        const auctionPk = new PublicKey(auctionPublicKey);
        const bidderPk = new PublicKey(bidderPublicKey);
        const [depositPda] = getDepositPDA(auctionPk, bidderPk);
        const sigs = await connection.getSignaturesForAddress(depositPda, { limit: 1 });
        setWasRefunded(sigs.length > 0);
      } catch {
        setWasRefunded(false);
      }
    } finally {
      setLoading(false);
    }
  }, [auctionPublicKey, bidderPublicKey, wallet, connection]);

  useEffect(() => {
    let stale = false;

    (async () => {
      if (!auctionPublicKey || !bidderPublicKey) {
        setDeposit(null);
        setWasRefunded(false);
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
        if (!stale) {
          setDeposit(account as unknown as BidderDepositAccount);
          setWasRefunded(false);
        }
      } catch {
        if (!stale) {
          setDeposit(null);
          try {
            const auctionPk = new PublicKey(auctionPublicKey);
            const bidderPk = new PublicKey(bidderPublicKey);
            const [depositPda] = getDepositPDA(auctionPk, bidderPk);
            const sigs = await connection.getSignaturesForAddress(depositPda, { limit: 1 });
            if (!stale) setWasRefunded(sigs.length > 0);
          } catch {
            if (!stale) setWasRefunded(false);
          }
        }
      } finally {
        if (!stale) setLoading(false);
      }
    })();

    return () => { stale = true; };
  }, [auctionPublicKey, bidderPublicKey, wallet, connection]);

  return { deposit, wasRefunded, loading, refetch: fetchDeposit };
}
