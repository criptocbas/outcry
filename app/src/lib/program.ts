import { AnchorProvider, Program } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { PROGRAM_ID, AUCTION_SEED, VAULT_SEED, DEPOSIT_SEED } from "./constants";
import idl from "./idl.json";

/**
 * Creates an Anchor Program instance for the Outcry auction program.
 *
 * @param connection - Solana RPC connection
 * @param wallet - Wallet adapter wallet (must implement AnchorWallet)
 * @returns Anchor Program instance typed to the Outcry IDL
 */
export function getProgram(
  connection: Connection,
  wallet: AnchorWallet
): Program {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  return new Program(idl as Idl, provider);
}

/**
 * Derives the AuctionState PDA.
 * Seeds: ["auction", seller_pubkey, nft_mint_pubkey]
 */
export function getAuctionPDA(
  seller: PublicKey,
  nftMint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [AUCTION_SEED, seller.toBuffer(), nftMint.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * Derives the AuctionVault PDA.
 * Seeds: ["vault", auction_state_pubkey]
 */
export function getVaultPDA(
  auctionState: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, auctionState.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * Derives the BidderDeposit PDA.
 * Seeds: ["deposit", auction_state_pubkey, bidder_pubkey]
 */
export function getDepositPDA(
  auctionState: PublicKey,
  bidder: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [DEPOSIT_SEED, auctionState.toBuffer(), bidder.toBuffer()],
    PROGRAM_ID
  );
}
