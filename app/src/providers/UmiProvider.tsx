"use client";

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { Umi } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { walletAdapterIdentity } from "@metaplex-foundation/umi-signer-wallet-adapters";
import { mplBubblegum } from "@metaplex-foundation/mpl-bubblegum";
import { dasApi } from "@metaplex-foundation/digital-asset-standard-api";
import { HELIUS_RPC } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const UmiContext = createContext<Umi | null>(null);

export function useUmi(): Umi {
  const umi = useContext(UmiContext);
  if (!umi) throw new Error("useUmi must be used within UmiProvider");
  return umi;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export default function UmiProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const { connection } = useConnection();

  // Use Helius for DAS API support, fall back to the current connection endpoint
  const endpoint = HELIUS_RPC || connection.rpcEndpoint;

  // Stabilize dependency — only recreate Umi when the connected key changes,
  // not on every render (wallet object reference is unstable).
  const walletKey = wallet.publicKey?.toBase58() ?? null;

  const umi = useMemo(() => {
    const instance = createUmi(endpoint)
      .use(mplBubblegum())
      .use(dasApi());

    // Attach wallet identity when connected
    if (walletKey) {
      return instance.use(walletAdapterIdentity(wallet));
    }

    return instance;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, walletKey]);

  return <UmiContext.Provider value={umi}>{children}</UmiContext.Provider>;
}
