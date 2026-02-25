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
import { PROGRAM_ID, DELEGATION_PROGRAM_ID, DEVNET_RPC, PROTOCOL_TREASURY } from "@/lib/constants";

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

  /** Cancel a Created auction (seller only, no bids). Returns NFT to seller. */
  cancelAuction: (auctionStatePubkey: PublicKey, nftMint: PublicKey) => Promise<string>;

  /** Close a Settled/Cancelled auction (seller only). Reclaims rent from all accounts. */
  closeAuction: (auctionStatePubkey: PublicKey, nftMint: PublicKey) => Promise<string>;

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

// Debug logger — suppressed in production builds to avoid leaking account details
const debugLog = process.env.NODE_ENV !== "production"
  ? (...args: unknown[]) => console.log(...args)
  : (() => {}) as (...args: unknown[]) => void;

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

  const MAX_RETRIES = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
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
      if (!data.result?.blockhash || typeof data.result.lastValidBlockHeight !== "number") {
        throw new Error("Invalid blockhash response from Magic Router");
      }
      return data.result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
      }
    }
  }

  throw lastError ?? new Error("getMagicBlockhash failed after retries");
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

  let blockhash: string;
  let lastValidBlockHeight: number;
  let sendConnection = connection;

  try {
    const result = await getMagicBlockhash(connection.rpcEndpoint, tx);
    blockhash = result.blockhash;
    lastValidBlockHeight = result.lastValidBlockHeight;
  } catch (err) {
    // ER unavailable — fall back to L1 blockhash. placeBid is a standard
    // Anchor instruction that works on both L1 and ER, so this is safe.
    debugLog("[sendErTransaction] ER unavailable, falling back to L1:", err);
    const l1Conn = new Connection(DEVNET_RPC, "confirmed");
    const result = await l1Conn.getLatestBlockhash("confirmed");
    blockhash = result.blockhash;
    lastValidBlockHeight = result.lastValidBlockHeight;
    sendConnection = l1Conn;
  }

  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;

  const signed = await walletAdapter.signTransaction(tx);
  const sig = await sendConnection.sendRawTransaction(signed.serialize(), {
    skipPreflight: true,
  });

  // Wait for confirmation (matches the test pattern). Without this,
  // sequential ER operations (end → undelegate) can race.
  try {
    await sendConnection.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      "confirmed"
    );
  } catch (confirmErr) {
    // Log but don't throw — the tx may have landed even if confirmation
    // times out (e.g. WebSocket flakiness).
    debugLog("[sendErTransaction] confirmation warning:", confirmErr);
  }

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

      debugLog("[settle] accounts:", {
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
      let tx;
      try {
        tx = await l1Program.methods
          .settleAuction()
          .accounts({
            payer: publicKey,
            auctionState: auctionStatePubkey,
            auctionVault,
            winnerDeposit,
            seller,
            winner,
            protocolTreasury: PROTOCOL_TREASURY,
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
        debugLog("[settle] transaction built, instructions:", tx.instructions.length);
      } catch (buildErr) {
        console.error("[settle] transaction build failed:", buildErr);
        throw new Error(`Transaction build failed: ${buildErr instanceof Error ? buildErr.message : String(buildErr)}`);
      }

      tx.feePayer = publicKey;
      const { blockhash, lastValidBlockHeight } =
        await l1Connection.getLatestBlockhash("finalized");
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;

      // Simulate before asking user to sign — catches on-chain errors early
      try {
        const simResult = await l1Connection.simulateTransaction(tx);
        if (simResult.value.err) {
          const simLogs = simResult.value.logs ?? [];
          const errorLog = simLogs.find(l => l.includes("Error") || l.includes("failed"));
          throw new Error(errorLog || JSON.stringify(simResult.value.err));
        }
        debugLog("[settle] simulation passed");
      } catch (simErr) {
        if (simErr instanceof Error && simErr.message.includes("Error")) {
          throw new Error(`Simulation failed: ${simErr.message}`);
        }
        // Non-critical simulation errors (e.g. RPC issues) — proceed anyway
        debugLog("[settle] simulation warning:", simErr);
      }

      let signed;
      try {
        signed = await wallet.signTransaction(tx);
        debugLog("[settle] transaction signed");
      } catch (signErr) {
        console.error("[settle] signing failed:", signErr);
        throw new Error(`Wallet signing failed: ${signErr instanceof Error ? signErr.message : String(signErr)}`);
      }

      let sig: string;
      try {
        sig = await l1Connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: true,
        });
        debugLog("[settle] sent, signature:", sig);
      } catch (sendErr: unknown) {
        console.error("[settle] sendRawTransaction failed:", sendErr);
        // Extract actual error from SendTransactionError
        const errObj = sendErr as { transactionMessage?: string; transactionLogs?: string[]; logs?: string[]; message?: string };
        const txMsg = errObj.transactionMessage || errObj.message || String(sendErr);
        const txLogs = errObj.transactionLogs || errObj.logs;
        if (txLogs) console.error("[settle] transaction logs:", txLogs);
        throw new Error(`Send failed: ${txMsg}`);
      }

      // Wait for confirmation and check for on-chain errors
      try {
        const confirmation = await l1Connection.confirmTransaction(
          { signature: sig, blockhash, lastValidBlockHeight },
          "finalized"
        );
        debugLog("[settle] confirmation result:", JSON.stringify(confirmation));

        // confirmTransaction resolves even for failed txs — must check .value.err
        if (confirmation.value.err) {
          // Fetch transaction logs for detailed error info
          const txDetails = await l1Connection.getTransaction(sig, {
            commitment: "finalized",
            maxSupportedTransactionVersion: 0,
          });
          const logs = txDetails?.meta?.logMessages ?? [];
          console.error("[settle] on-chain error:", confirmation.value.err);
          console.error("[settle] program logs:", logs);

          // Extract meaningful error from logs
          const errorLog = logs.find(l => l.includes("Error") || l.includes("failed"));
          throw new Error(`Transaction failed: ${errorLog || JSON.stringify(confirmation.value.err)}`);
        }

        debugLog("[settle] confirmed successfully:", sig);
      } catch (confirmErr: unknown) {
        // Re-throw if it's our own error from above
        if (confirmErr instanceof Error && confirmErr.message.startsWith("Transaction failed:")) {
          throw confirmErr;
        }
        console.error("[settle] confirmation failed:", confirmErr);
        // Check if tx actually succeeded despite confirmation timeout
        const status = await l1Connection.getSignatureStatus(sig);
        debugLog("[settle] signature status:", JSON.stringify(status));
        if (status?.value?.err) {
          throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.value.err)}`);
        }
        if (status?.value?.confirmationStatus === "confirmed" || status?.value?.confirmationStatus === "finalized") {
          debugLog("[settle] transaction actually succeeded despite confirmation error");
          return sig;
        }
        throw new Error(`Confirmation failed: ${confirmErr instanceof Error ? confirmErr.message : String(confirmErr)}`);
      }

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

  // -----------------------------------------------------------------------
  // cancelAuction (L1 — seller cancels Created auction)
  // -----------------------------------------------------------------------
  const cancelAuction = useCallback(
    async (auctionStatePubkey: PublicKey, nftMint: PublicKey): Promise<string> => {
      if (!l1Program || !publicKey) {
        throw new Error("Wallet not connected");
      }

      const escrowNftTokenAccount = await getAssociatedTokenAddress(
        nftMint,
        auctionStatePubkey,
        true
      );

      const sellerNftTokenAccount = await getAssociatedTokenAddress(
        nftMint,
        publicKey
      );

      const sig = await l1Program.methods
        .cancelAuction()
        .accounts({
          seller: publicKey,
          auctionState: auctionStatePubkey,
          nftMint,
          escrowNftTokenAccount,
          sellerNftTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc({ skipPreflight: true });

      return sig;
    },
    [l1Program, publicKey]
  );

  // -----------------------------------------------------------------------
  // closeAuction (L1 — seller reclaims rent after Settled/Cancelled)
  // -----------------------------------------------------------------------
  const closeAuction = useCallback(
    async (auctionStatePubkey: PublicKey, nftMint: PublicKey): Promise<string> => {
      if (!l1Program || !publicKey) {
        throw new Error("Wallet not connected");
      }

      const [auctionVault] = getVaultPDA(auctionStatePubkey);

      const escrowNftTokenAccount = await getAssociatedTokenAddress(
        nftMint,
        auctionStatePubkey,
        true
      );

      const sig = await l1Program.methods
        .closeAuction()
        .accounts({
          seller: publicKey,
          auctionState: auctionStatePubkey,
          auctionVault,
          nftMint,
          escrowNftTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
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
    cancelAuction,
    closeAuction,
    ready: !!l1Program && !!publicKey,
  };
}
