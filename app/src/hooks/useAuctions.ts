"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAnchorWallet } from "@solana/wallet-adapter-react";
import { Connection, PublicKey } from "@solana/web3.js";
import { getProgram, getReadOnlyProgram } from "@/lib/program";
import { getMagicConnection } from "@/lib/magic-router";
import { DEVNET_RPC, DELEGATION_PROGRAM_ID } from "@/lib/constants";
import type { AuctionAccount, AuctionStatusLabel } from "./useAuction";
import { parseAuctionStatus } from "./useAuction";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuctionWithKey {
  publicKey: PublicKey;
  account: AuctionAccount;
}

export interface UseAuctionsReturn {
  auctions: AuctionWithKey[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Sorting helpers
// ---------------------------------------------------------------------------

const STATUS_SORT_ORDER: Record<AuctionStatusLabel, number> = {
  Active: 0,
  Created: 1,
  Ended: 2,
  Settled: 3,
  Cancelled: 4,
};

function sortAuctions(a: AuctionWithKey, b: AuctionWithKey): number {
  const aStatus = parseAuctionStatus(a.account.status);
  const bStatus = parseAuctionStatus(b.account.status);
  return (STATUS_SORT_ORDER[aStatus] ?? 99) - (STATUS_SORT_ORDER[bStatus] ?? 99);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuctions(): UseAuctionsReturn {
  // Standard devnet for getProgramAccounts (listing) — Magic Router doesn't support it
  const l1Connection = useMemo(() => new Connection(DEVNET_RPC, "confirmed"), []);
  // Magic Router for individual account fetches (sees ER-delegated state)
  const magicConnection = useMemo(() => getMagicConnection(), []);
  const wallet = useAnchorWallet();

  const [auctions, setAuctions] = useState<AuctionWithKey[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAuctions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Step 1: Get non-delegated auction accounts from L1 (owned by OUTCRY program)
      const l1Program = wallet ? getProgram(l1Connection, wallet) : getReadOnlyProgram(l1Connection);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const l1Accounts = await (l1Program.account as any).auctionState.all();

      // Step 2: Get delegated auction account keys (owned by delegation program).
      // When an auction is delegated to ER, L1 owner changes to delegation program
      // but the data (including Anchor discriminator) stays intact.
      // AuctionState discriminator in base58: [252, 227, 205, 147, 72, 64, 250, 126]
      const DISCRIMINATOR_BASE58 = "jJMCxUdy3ch";

      let delegatedKeys: PublicKey[] = [];
      try {
        const rawDelegated = await l1Connection.getProgramAccounts(
          DELEGATION_PROGRAM_ID,
          {
            dataSlice: { offset: 0, length: 0 }, // only need pubkeys, skip data
            filters: [
              { memcmp: { offset: 0, bytes: DISCRIMINATOR_BASE58 } },
            ],
          }
        );
        delegatedKeys = rawDelegated.map((raw) => raw.pubkey);
      } catch (err) {
        console.warn("Failed to query delegated auctions:", err);
      }

      // Step 3: Merge pubkeys and dedup. We'll re-fetch via Magic Router for data.
      const seenKeys = new Set<string>();
      const allKeys: PublicKey[] = [];
      for (const item of l1Accounts) {
        const key = item.publicKey.toBase58();
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          allKeys.push(item.publicKey);
        }
      }
      for (const pk of delegatedKeys) {
        const key = pk.toBase58();
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          allKeys.push(pk);
        }
      }

      // Step 4: Re-fetch each account via Magic Router to get latest state
      // (delegated accounts will return ER state, others return L1 state)
      const magicProgram = wallet ? getProgram(magicConnection, wallet) : getReadOnlyProgram(magicConnection);
      const results = await Promise.all(
        allKeys.map(async (pk) => {
          try {
            const fresh = await (magicProgram.account as Record<string, { fetch: (key: PublicKey) => Promise<unknown> }>)["auctionState"].fetch(pk);
            return {
              publicKey: pk,
              account: fresh as unknown as AuctionAccount,
            };
          } catch {
            // Account may be mid-transition or closed — skip it
            return null;
          }
        })
      );
      // Hide known stuck/broken auctions (ER delegation orphaned)
      const HIDDEN_AUCTIONS = new Set([
        "Hr1iDC1G19qGaNydq2QV5aazKA6HG9dqi22w3GUV7Vzn",
      ]);

      const mapped: AuctionWithKey[] = results
        .filter((r): r is AuctionWithKey => r !== null)
        .filter((a) => !HIDDEN_AUCTIONS.has(a.publicKey.toBase58()));

      mapped.sort(sortAuctions);

      setAuctions(mapped);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch auctions";
      setError(message);
      setAuctions([]);
    } finally {
      setLoading(false);
    }
  }, [wallet, l1Connection, magicConnection]);

  // Initial fetch
  useEffect(() => {
    fetchAuctions();
  }, [fetchAuctions]);

  return {
    auctions,
    loading,
    error,
    refetch: fetchAuctions,
  };
}
