"use client";

import { useCallback, useMemo } from "react";
import {
  useAnchorWallet,
  useWallet,
} from "@solana/wallet-adapter-react";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import BN from "bn.js";
import { getProgram, getAuctionPDA, getVaultPDA, getDepositPDA, getMetadataPDA, parseMetadataCreators } from "@/lib/program";
import { getMagicConnection } from "@/lib/magic-router";
import { PROGRAM_ID, DELEGATION_PROGRAM_ID, DEVNET_RPC } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateAuctionParams {
  nftMint: PublicKey;
  reservePrice: BN;
  durationSeconds: BN;
  extensionSeconds: number;
  extensionWindow: number;
  minBidIncrement: BN;
}

export interface UseAuctionActionsReturn {
  /** Create a new auction. Wallet signer is the seller. */
  createAuction: (params: CreateAuctionParams) => Promise<string>;

  /** Deposit SOL into the auction vault as a bidder. */
  deposit: (auctionStatePubkey: PublicKey, amount: BN) => Promise<string>;

  /** Start an auction (seller only). Sets status to Active. */
  startAuction: (auctionStatePubkey: PublicKey, nftMint: PublicKey) => Promise<string>;

  /** Delegate the AuctionState PDA to the Ephemeral Rollup (seller only). */
  delegateAuction: (auctionStatePubkey: PublicKey, nftMint: PublicKey) => Promise<string>;

  /** Place a bid on an active (possibly ER-delegated) auction. */
  placeBid: (auctionStatePubkey: PublicKey, amount: BN) => Promise<string>;

  /** End an auction (permissionless crank). */
  endAuction: (auctionStatePubkey: PublicKey) => Promise<string>;

  /** Undelegate the AuctionState back to L1 (after ending). */
  undelegateAuction: (auctionStatePubkey: PublicKey) => Promise<string>;

  /** Settle an ended auction — transfer NFT + distribute SOL. */
  settleAuction: (
    auctionStatePubkey: PublicKey,
    nftMint: PublicKey,
    seller: PublicKey,
    winner: PublicKey
  ) => Promise<string>;

  /** Claim a refund of deposited SOL (losers, after settlement/cancellation). */
  claimRefund: (auctionStatePubkey: PublicKey) => Promise<string>;

  /** Forfeit a defaulted auction — winner didn't deposit enough. Returns NFT to seller. */
  forfeitAuction: (
    auctionStatePubkey: PublicKey,
    nftMint: PublicKey,
    seller: PublicKey,
    winner: PublicKey
  ) => Promise<string>;

  /** True when the wallet is connected and actions are available. */
  ready: boolean;
}

// ---------------------------------------------------------------------------
// PDA helpers for delegation accounts
// ---------------------------------------------------------------------------

function getDelegationBufferPDA(
  auctionState: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("buffer"), auctionState.toBuffer()],
    PROGRAM_ID
  );
}

function getDelegationRecordPDA(
  auctionState: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("delegation"), auctionState.toBuffer()],
    DELEGATION_PROGRAM_ID
  );
}

function getDelegationMetadataPDA(
  auctionState: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("delegation-metadata"), auctionState.toBuffer()],
    DELEGATION_PROGRAM_ID
  );
}

// Magic Program addresses (auto-added by #[commit] macro)
const MAGIC_PROGRAM_ID = new PublicKey("Magic11111111111111111111111111111111111111");
const MAGIC_CONTEXT_ID = new PublicKey("MagicContext1111111111111111111111111111111");

/**
 * Get the correct blockhash for a Magic Router transaction.
 *
 * The ER has its own blockhash progression separate from L1. The Magic Router
 * exposes a custom `getBlockhashForAccounts` RPC that inspects which accounts
 * are delegated and returns the appropriate blockhash.
 */
async function getMagicBlockhash(
  rpcEndpoint: string,
  tx: import("@solana/web3.js").Transaction
): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  const writableAccounts = new Set<string>();
  if (tx.feePayer) writableAccounts.add(tx.feePayer.toBase58());
  for (const ix of tx.instructions) {
    for (const key of ix.keys) {
      if (key.isWritable) writableAccounts.add(key.pubkey.toBase58());
    }
  }

  const res = await fetch(rpcEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getBlockhashForAccounts",
      params: [Array.from(writableAccounts)],
    }),
  });
  const data = await res.json();
  return data.result;
}

/**
 * Send a transaction through the Magic Router with the correct blockhash.
 *
 * Anchor's `.rpc()` uses `getLatestBlockhash()` which returns L1 blockhash,
 * but the ER has its own blockhash progression. Using `.rpc()` causes
 * "Blockhash not found" because the wallet signs with an L1 blockhash but the
 * tx is routed to the ER (or vice versa).
 *
 * This helper:
 * 1. Builds the unsigned transaction via Anchor's `.transaction()`
 * 2. Calls `getBlockhashForAccounts` on the Magic Router to get the correct
 *    blockhash (ER or L1 depending on delegation status)
 * 3. Signs with the wallet adapter
 * 4. Sends as raw bytes — bypassing the problematic sendTransaction override
 */
async function sendErTransaction(
  txBuilder: { transaction: () => Promise<import("@solana/web3.js").Transaction> },
  walletAdapter: { signTransaction: (tx: import("@solana/web3.js").Transaction) => Promise<import("@solana/web3.js").Transaction> },
  feePayer: PublicKey,
  connection: Connection
): Promise<string> {
  const tx = await txBuilder.transaction();
  tx.feePayer = feePayer;

  const { blockhash, lastValidBlockHeight } = await getMagicBlockhash(
    connection.rpcEndpoint,
    tx
  );
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;

  const signed = await walletAdapter.signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: true,
  });
  return sig;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuctionActions(): UseAuctionActionsReturn {
  const wallet = useAnchorWallet();
  const { publicKey } = useWallet();

  // Standard devnet connection for L1-only operations (create, deposit, start, settle, refund)
  const l1Connection = useMemo(
    () => new Connection(DEVNET_RPC, "confirmed"),
    []
  );

  // Magic Router for ER-routed operations (placeBid, endAuction, undelegateAuction)
  const magicConnection = useMemo(() => getMagicConnection(), []);

  // L1 program — used for transactions that only touch L1 accounts
  const l1Program = useMemo(() => {
    if (!wallet) return null;
    return getProgram(l1Connection, wallet);
  }, [l1Connection, wallet]);

  // ER program — used for transactions that may route to Ephemeral Rollup
  const erProgram = useMemo(() => {
    if (!wallet) return null;
    return getProgram(magicConnection, wallet);
  }, [magicConnection, wallet]);

  // -----------------------------------------------------------------------
  // createAuction (L1)
  // -----------------------------------------------------------------------
  const createAuction = useCallback(
    async (params: CreateAuctionParams): Promise<string> => {
      if (!l1Program || !publicKey) {
        throw new Error("Wallet not connected");
      }

      const {
        nftMint,
        reservePrice,
        durationSeconds,
        extensionSeconds,
        extensionWindow,
        minBidIncrement,
      } = params;

      const [auctionState] = getAuctionPDA(publicKey, nftMint);
      const [auctionVault] = getVaultPDA(auctionState);

      const sellerNftTokenAccount = await getAssociatedTokenAddress(
        nftMint,
        publicKey
      );

      const escrowNftTokenAccount = await getAssociatedTokenAddress(
        nftMint,
        auctionState,
        true // allowOwnerOffCurve — PDA owner
      );

      const sig = await l1Program.methods
        .createAuction(
          reservePrice,
          durationSeconds,
          extensionSeconds,
          extensionWindow,
          minBidIncrement
        )
        .accounts({
          seller: publicKey,
          nftMint,
          sellerNftTokenAccount,
          escrowNftTokenAccount,
          auctionState,
          auctionVault,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ skipPreflight: true });

      return sig;
    },
    [l1Program, publicKey]
  );

  // -----------------------------------------------------------------------
  // deposit (L1)
  // -----------------------------------------------------------------------
  const deposit = useCallback(
    async (auctionStatePubkey: PublicKey, amount: BN): Promise<string> => {
      if (!l1Program || !publicKey) {
        throw new Error("Wallet not connected");
      }

      const [auctionVault] = getVaultPDA(auctionStatePubkey);
      const [bidderDeposit] = getDepositPDA(auctionStatePubkey, publicKey);

      const sig = await l1Program.methods
        .deposit(amount)
        .accounts({
          bidder: publicKey,
          auctionState: auctionStatePubkey,
          bidderDeposit,
          auctionVault,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ skipPreflight: true });

      return sig;
    },
    [l1Program, publicKey]
  );

  // -----------------------------------------------------------------------
  // startAuction (L1)
  // -----------------------------------------------------------------------
  const startAuction = useCallback(
    async (auctionStatePubkey: PublicKey, nftMint: PublicKey): Promise<string> => {
      if (!l1Program || !publicKey) {
        throw new Error("Wallet not connected");
      }

      const sig = await l1Program.methods
        .startAuction()
        .accounts({
          seller: publicKey,
          auctionState: auctionStatePubkey,
        })
        .rpc({ skipPreflight: true });

      return sig;
    },
    [l1Program, publicKey]
  );

  // -----------------------------------------------------------------------
  // delegateAuction (L1 → delegates AuctionState to ER)
  // -----------------------------------------------------------------------
  const delegateAuction = useCallback(
    async (auctionStatePubkey: PublicKey, nftMint: PublicKey): Promise<string> => {
      if (!l1Program || !publicKey) {
        throw new Error("Wallet not connected");
      }

      const [bufferPda] = getDelegationBufferPDA(auctionStatePubkey);
      const [delegationRecord] = getDelegationRecordPDA(auctionStatePubkey);
      const [delegationMetadata] = getDelegationMetadataPDA(auctionStatePubkey);

      const sig = await l1Program.methods
        .delegateAuction(nftMint)
        .accounts({
          seller: publicKey,
          auctionState: auctionStatePubkey,
          bufferAuctionState: bufferPda,
          delegationRecordAuctionState: delegationRecord,
          delegationMetadataAuctionState: delegationMetadata,
          ownerProgram: PROGRAM_ID,
          delegationProgram: DELEGATION_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ skipPreflight: true });

      return sig;
    },
    [l1Program, publicKey]
  );

  // -----------------------------------------------------------------------
  // placeBid (auto-routed to ER if delegated)
  // -----------------------------------------------------------------------
  const placeBid = useCallback(
    async (auctionStatePubkey: PublicKey, amount: BN): Promise<string> => {
      if (!erProgram || !publicKey || !wallet) {
        throw new Error("Wallet not connected");
      }

      return sendErTransaction(
        erProgram.methods
          .placeBid(amount)
          .accounts({
            bidder: publicKey,
            auctionState: auctionStatePubkey,
          }),
        wallet,
        publicKey,
        magicConnection
      );
    },
    [erProgram, publicKey, wallet, magicConnection]
  );

  // -----------------------------------------------------------------------
  // endAuction (auto-routed to ER if delegated)
  // -----------------------------------------------------------------------
  const endAuction = useCallback(
    async (auctionStatePubkey: PublicKey): Promise<string> => {
      if (!erProgram || !publicKey || !wallet) {
        throw new Error("Wallet not connected");
      }

      return sendErTransaction(
        erProgram.methods
          .endAuction()
          .accounts({
            authority: publicKey,
            auctionState: auctionStatePubkey,
          }),
        wallet,
        publicKey,
        magicConnection
      );
    },
    [erProgram, publicKey, wallet, magicConnection]
  );

  // -----------------------------------------------------------------------
  // undelegateAuction (sent to ER → commits state back to L1)
  // -----------------------------------------------------------------------
  const undelegateAuction = useCallback(
    async (auctionStatePubkey: PublicKey): Promise<string> => {
      if (!erProgram || !publicKey || !wallet) {
        throw new Error("Wallet not connected");
      }

      return sendErTransaction(
        erProgram.methods
          .undelegateAuction()
          .accounts({
            payer: publicKey,
            auctionState: auctionStatePubkey,
            magicProgram: MAGIC_PROGRAM_ID,
            magicContext: MAGIC_CONTEXT_ID,
          }),
        wallet,
        publicKey,
        magicConnection
      );
    },
    [erProgram, publicKey, wallet, magicConnection]
  );

  // -----------------------------------------------------------------------
  // settleAuction (L1, after undelegation)
  // -----------------------------------------------------------------------
  const settleAuction = useCallback(
    async (
      auctionStatePubkey: PublicKey,
      nftMint: PublicKey,
      seller: PublicKey,
      winner: PublicKey
    ): Promise<string> => {
      if (!l1Program || !publicKey || !wallet) {
        throw new Error("Wallet not connected");
      }

      const [auctionVault] = getVaultPDA(auctionStatePubkey);
      const [winnerDeposit] = getDepositPDA(auctionStatePubkey, winner);
      const [nftMetadata] = getMetadataPDA(nftMint);

      const escrowNftTokenAccount = await getAssociatedTokenAddress(
        nftMint,
        auctionStatePubkey,
        true // allowOwnerOffCurve — PDA owner
      );

      const winnerNftTokenAccount = await getAssociatedTokenAddress(
        nftMint,
        winner
      );

      // Fetch metadata account to get creator list for remaining_accounts
      const metadataAccountInfo = await l1Connection.getAccountInfo(nftMetadata);
      const remainingAccounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];

      if (metadataAccountInfo?.data) {
        const parsed = parseMetadataCreators(metadataAccountInfo.data);
        if (parsed && parsed.sellerFeeBps > 0 && parsed.creators.length > 0) {
          for (const creator of parsed.creators) {
            if (creator.share > 0) {
              remainingAccounts.push({
                pubkey: creator.address,
                isSigner: false,
                isWritable: true,
              });
            }
          }
        }
      }

      console.log("[settle] accounts:", {
        payer: publicKey.toBase58(),
        auctionState: auctionStatePubkey.toBase58(),
        auctionVault: auctionVault.toBase58(),
        winnerDeposit: winnerDeposit.toBase58(),
        seller: seller.toBase58(),
        winner: winner.toBase58(),
        nftMint: nftMint.toBase58(),
        nftMetadata: nftMetadata.toBase58(),
        escrowNftTokenAccount: escrowNftTokenAccount.toBase58(),
        winnerNftTokenAccount: winnerNftTokenAccount.toBase58(),
        remainingAccounts: remainingAccounts.map(a => a.pubkey.toBase58()),
        metadataExists: !!metadataAccountInfo,
      });

      // Build transaction manually for better error handling
      const tx = await l1Program.methods
        .settleAuction()
        .accounts({
          payer: publicKey,
          auctionState: auctionStatePubkey,
          auctionVault,
          winnerDeposit,
          seller,
          winner,
          nftMint,
          nftMetadata,
          escrowNftTokenAccount,
          winnerNftTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts)
        .transaction();

      tx.feePayer = publicKey;
      const { blockhash, lastValidBlockHeight } =
        await l1Connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;

      const signed = await wallet.signTransaction(tx);
      const sig = await l1Connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: true,
      });

      // Wait for confirmation
      await l1Connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed"
      );

      return sig;
    },
    [l1Program, l1Connection, publicKey, wallet]
  );

  // -----------------------------------------------------------------------
  // claimRefund (L1)
  // -----------------------------------------------------------------------
  const claimRefund = useCallback(
    async (auctionStatePubkey: PublicKey): Promise<string> => {
      if (!l1Program || !publicKey) {
        throw new Error("Wallet not connected");
      }

      const [auctionVault] = getVaultPDA(auctionStatePubkey);
      const [bidderDeposit] = getDepositPDA(auctionStatePubkey, publicKey);

      const sig = await l1Program.methods
        .claimRefund()
        .accounts({
          bidder: publicKey,
          auctionState: auctionStatePubkey,
          bidderDeposit,
          auctionVault,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ skipPreflight: true });

      return sig;
    },
    [l1Program, publicKey]
  );

  // -----------------------------------------------------------------------
  // forfeitAuction (L1 — handles defaulted winner)
  // -----------------------------------------------------------------------
  const forfeitAuction = useCallback(
    async (
      auctionStatePubkey: PublicKey,
      nftMint: PublicKey,
      seller: PublicKey,
      winner: PublicKey
    ): Promise<string> => {
      if (!l1Program || !publicKey) {
        throw new Error("Wallet not connected");
      }

      const [auctionVault] = getVaultPDA(auctionStatePubkey);
      const [winnerDeposit] = getDepositPDA(auctionStatePubkey, winner);

      const escrowNftTokenAccount = await getAssociatedTokenAddress(
        nftMint,
        auctionStatePubkey,
        true
      );

      const sellerNftTokenAccount = await getAssociatedTokenAddress(
        nftMint,
        seller
      );

      const sig = await l1Program.methods
        .forfeitAuction()
        .accounts({
          payer: publicKey,
          auctionState: auctionStatePubkey,
          auctionVault,
          winnerDeposit,
          seller,
          nftMint,
          escrowNftTokenAccount,
          sellerNftTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ skipPreflight: true });

      return sig;
    },
    [l1Program, publicKey]
  );

  return {
    createAuction,
    deposit,
    startAuction,
    delegateAuction,
    placeBid,
    endAuction,
    undelegateAuction,
    settleAuction,
    claimRefund,
    forfeitAuction,
    ready: !!l1Program && !!publicKey,
  };
}
