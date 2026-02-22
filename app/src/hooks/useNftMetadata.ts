"use client";

import { useState, useEffect } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { DEVNET_RPC } from "@/lib/constants";

// Metaplex Token Metadata Program
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

// Reuse a single connection for all metadata fetches
const metadataConnection = new Connection(DEVNET_RPC, "confirmed");

export interface NftMetadata {
  name: string;
  symbol: string;
  image: string | null;
  description: string | null;
  uri: string;
}

// Module-level cache so we don't re-fetch across components/renders
const metadataCache = new Map<string, NftMetadata>();

/**
 * Derives the Metaplex Metadata PDA for a given mint.
 * Seeds: ["metadata", TOKEN_METADATA_PROGRAM_ID, mint]
 */
function getMetadataPDA(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
  return pda;
}

/**
 * Parse a Metaplex v1 metadata account buffer.
 * Layout (after 1-byte key prefix):
 *   update_authority: 32 bytes
 *   mint: 32 bytes
 *   name: 4-byte length prefix + 32 bytes (padded with \0)
 *   symbol: 4-byte length prefix + 10 bytes (padded with \0)
 *   uri: 4-byte length prefix + 200 bytes (padded with \0)
 */
function parseMetadataAccount(
  data: Buffer
): { name: string; symbol: string; uri: string } | null {
  try {
    // Skip: key (1) + update_authority (32) + mint (32) = 65
    let offset = 1 + 32 + 32;

    // Name: 4-byte LE length prefix + 32 bytes data
    const nameLen = data.readUInt32LE(offset);
    offset += 4;
    const name = data
      .slice(offset, offset + Math.min(nameLen, 32))
      .toString("utf8")
      .replace(/\0/g, "")
      .trim();
    offset += 32;

    // Symbol: 4-byte LE length prefix + 10 bytes data
    const symbolLen = data.readUInt32LE(offset);
    offset += 4;
    const symbol = data
      .slice(offset, offset + Math.min(symbolLen, 10))
      .toString("utf8")
      .replace(/\0/g, "")
      .trim();
    offset += 10;

    // URI: 4-byte LE length prefix + 200 bytes data
    const uriLen = data.readUInt32LE(offset);
    offset += 4;
    const uri = data
      .slice(offset, offset + Math.min(uriLen, 200))
      .toString("utf8")
      .replace(/\0/g, "")
      .trim();

    return { name, symbol, uri };
  } catch {
    return null;
  }
}

/**
 * Fetches NFT metadata for a given mint address.
 * 1. Reads the on-chain Metaplex metadata account
 * 2. Parses the URI
 * 3. Fetches the off-chain JSON for the image
 */
export function useNftMetadata(mintAddress: string | null): {
  metadata: NftMetadata | null;
  loading: boolean;
} {
  const [metadata, setMetadata] = useState<NftMetadata | null>(
    mintAddress ? metadataCache.get(mintAddress) ?? null : null
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!mintAddress) {
      setMetadata(null);
      return;
    }

    // Check cache first
    const cached = metadataCache.get(mintAddress);
    if (cached) {
      setMetadata(cached);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const mint = new PublicKey(mintAddress);
        const metadataPDA = getMetadataPDA(mint);
        const accountInfo = await metadataConnection.getAccountInfo(metadataPDA);

        if (!accountInfo || cancelled) {
          if (!cancelled) setLoading(false);
          return;
        }

        const parsed = parseMetadataAccount(accountInfo.data as Buffer);
        if (!parsed || !parsed.uri || cancelled) {
          if (!cancelled) setLoading(false);
          return;
        }

        // Fetch off-chain JSON metadata
        let image: string | null = null;
        let description: string | null = null;
        let offChainName = parsed.name;

        try {
          const res = await fetch(parsed.uri);
          if (res.ok) {
            const json = await res.json();
            image = json.image || json.image_url || null;
            description = json.description || null;
            if (json.name) offChainName = json.name;
          }
        } catch {
          // Off-chain fetch failed — we still have on-chain name/symbol
        }

        if (cancelled) return;

        const result: NftMetadata = {
          name: offChainName,
          symbol: parsed.symbol,
          image,
          description,
          uri: parsed.uri,
        };

        metadataCache.set(mintAddress, result);
        setMetadata(result);
      } catch {
        // Metadata account doesn't exist or parse failed
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mintAddress]);

  return { metadata, loading };
}
