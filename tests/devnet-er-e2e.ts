/**
 * OUTCRY — Devnet Ephemeral Rollup E2E Test
 *
 * Tests the full auction lifecycle WITH MagicBlock ER delegation:
 *   L1: create → deposit → start → delegate
 *   ER: place_bid → end_auction → undelegate
 *   L1: settle → claim_refund → close
 *
 * This validates sub-50ms bidding via Ephemeral Rollups while SOL deposits
 * remain safe on L1 via BidderDeposit PDAs.
 *
 * Usage:
 *   npx ts-mocha -p ./tsconfig.json -t 1000000 tests/devnet-er-e2e.ts
 *
 * Prerequisites:
 *   - Program deployed at J7r5mzvVUjSNQteoqn6Hd3LjZ3ksmwoD5xsnUvMJwPZo on devnet
 *   - Deployer wallet at ~/.config/solana/id.json with devnet SOL
 */

import anchor from "@coral-xyz/anchor";
const { Program, AnchorProvider, Wallet, BN } = anchor;
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getAssociatedTokenAddress,
  createAssociatedTokenAccount,
  getAccount,
} from "@solana/spl-token";
import { ConnectionMagicRouter } from "@magicblock-labs/ephemeral-rollups-sdk";
import { expect } from "chai";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROGRAM_ID = new PublicKey(
  "J7r5mzvVUjSNQteoqn6Hd3LjZ3ksmwoD5xsnUvMJwPZo"
);

import {
  PROTOCOL_TREASURY,
  getMetadataPDA,
  getDepositPDA as getDepositPDAHelper,
  createMetadataV3Instruction,
  sleep,
} from "./helpers";

const DELEGATION_PROGRAM_ID = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
);

const MAGIC_PROGRAM_ID = new PublicKey(
  "Magic11111111111111111111111111111111111111"
);

const MAGIC_CONTEXT_ID = new PublicKey(
  "MagicContext1111111111111111111111111111111"
);

const MAGIC_ROUTER_RPC = "https://devnet-router.magicblock.app/";
const MAGIC_ROUTER_WS = "wss://devnet-router.magicblock.app/";

// Use Helius for reliability, fall back to public devnet
const DEVNET_RPC =
  process.env.NEXT_PUBLIC_HELIUS_RPC || "https://api.devnet.solana.com";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadKeypair(filePath: string): Keypair {
  const resolved = filePath.replace("~", process.env.HOME || "");
  const raw = fs.readFileSync(resolved, "utf-8");
  const secretKey = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secretKey);
}

function loadIdl(): any {
  const idlPath = path.join(process.cwd(), "target", "idl", "outcry.json");
  return JSON.parse(fs.readFileSync(idlPath, "utf-8"));
}

function lamportsToSol(lamports: number | bigint): string {
  return (Number(lamports) / LAMPORTS_PER_SOL).toFixed(6);
}

// sleep, getMetadataPDA, createMetadataV3Instruction imported from ./helpers

function getDepositPDA(
  auctionState: PublicKey,
  bidder: PublicKey
): [PublicKey, number] {
  return getDepositPDAHelper(auctionState, bidder, PROGRAM_ID);
}

// Delegation-related PDAs
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

/**
 * Get the correct blockhash for a Magic Router transaction.
 * The ER has its own blockhash progression separate from L1.
 */
async function getMagicBlockhash(
  tx: Transaction
): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  const writableAccounts = new Set<string>();
  if (tx.feePayer) writableAccounts.add(tx.feePayer.toBase58());
  for (const ix of tx.instructions) {
    for (const key of ix.keys) {
      if (key.isWritable) writableAccounts.add(key.pubkey.toBase58());
    }
  }

  const res = await fetch(MAGIC_ROUTER_RPC, {
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
  if (!data.result) {
    throw new Error(
      `getBlockhashForAccounts failed: ${JSON.stringify(data.error || data)}`
    );
  }
  return data.result;
}

/**
 * Send a transaction through the Magic Router with the correct blockhash.
 * Used for ER-routed operations (place_bid, end_auction, undelegate).
 */
async function sendErTransaction(
  program: any,
  methodBuilder: any,
  signer: Keypair,
  magicConnection: ConnectionMagicRouter
): Promise<string> {
  // 1. Build unsigned transaction
  const tx: Transaction = await methodBuilder.transaction();
  tx.feePayer = signer.publicKey;

  // 2. Get correct blockhash from Magic Router
  const { blockhash, lastValidBlockHeight } = await getMagicBlockhash(tx);
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;

  // 3. Sign with keypair
  tx.sign(signer);

  // 4. Send raw bytes via Magic Router
  const sig = await magicConnection.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
  });

  // 5. Wait for confirmation
  await magicConnection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed"
  );

  return sig;
}

// createMetadataV3Instruction imported from ./helpers

async function fundFromWallet(
  connection: Connection,
  payer: Keypair,
  recipient: PublicKey,
  amount: number
): Promise<void> {
  const balance = await connection.getBalance(recipient);
  if (balance >= amount) {
    console.log(
      `    ${recipient.toBase58().slice(0, 8)}... already has ${lamportsToSol(balance)} SOL`
    );
    return;
  }
  console.log(
    `    Transferring ${lamportsToSol(amount)} SOL to ${recipient.toBase58().slice(0, 8)}...`
  );
  const { sendAndConfirmTransaction } = await import("@solana/web3.js");
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipient,
      lamports: amount,
    })
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
  console.log(`    Transfer confirmed: ${sig}`);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("outcry devnet ER e2e", function () {
  this.timeout(600_000); // 10 minutes

  // L1 connection
  const connection = new Connection(DEVNET_RPC, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60_000,
  });

  // Magic Router connection (auto-routes delegated ↔ L1)
  const magicConnection = new ConnectionMagicRouter(MAGIC_ROUTER_RPC, {
    wsEndpoint: MAGIC_ROUTER_WS,
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60_000,
  });

  // Seller = deployer wallet
  const seller = loadKeypair("~/.config/solana/id.json");
  const wallet = new Wallet(seller);

  // L1 provider + program
  const l1Provider = new AnchorProvider(connection, wallet, {
    preflightCommitment: "confirmed",
    commitment: "confirmed",
  });
  anchor.setProvider(l1Provider);
  const idl = loadIdl();
  const l1Program = new Program(idl, l1Provider) as any;

  // ER provider + program (Magic Router connection)
  const erProvider = new AnchorProvider(magicConnection as any, wallet, {
    preflightCommitment: "confirmed",
    commitment: "confirmed",
  });
  const erProgram = new Program(idl, erProvider) as any;

  // Bidder = freshly generated keypair
  const bidder = Keypair.generate();

  // State — set during tests
  let nftMint: PublicKey;
  let sellerNftAta: PublicKey;
  let auctionState: PublicKey;
  let auctionBump: number;
  let auctionVault: PublicKey;
  let escrowNftAta: PublicKey;
  let bidderDepositPda: PublicKey;

  // Auction params
  const reservePrice = new BN(0.05 * LAMPORTS_PER_SOL);
  const durationSeconds = new BN(15); // 15 seconds (enough for delegation + bid + end)
  const extensionSeconds = 5;
  const extensionWindow = 5;
  const minBidIncrement = new BN(0.01 * LAMPORTS_PER_SOL);

  // -----------------------------------------------------------------------
  // Setup
  // -----------------------------------------------------------------------

  before(async () => {
    console.log("\n=== OUTCRY Devnet ER E2E Test ===");
    console.log(`  Program:       ${PROGRAM_ID.toBase58()}`);
    console.log(`  L1 RPC:        ${DEVNET_RPC.slice(0, 50)}...`);
    console.log(`  Magic Router:  ${MAGIC_ROUTER_RPC}`);
    console.log(`  Seller:        ${seller.publicKey.toBase58()}`);
    console.log(`  Bidder:        ${bidder.publicKey.toBase58()}`);
    console.log("");

    // Check seller balance
    const sellerBal = await connection.getBalance(seller.publicKey);
    console.log(`  Seller balance: ${lamportsToSol(sellerBal)} SOL`);
    expect(sellerBal).to.be.greaterThan(
      1 * LAMPORTS_PER_SOL,
      "Seller needs at least 1 SOL"
    );

    // Fund bidder
    await fundFromWallet(
      connection,
      seller,
      bidder.publicKey,
      0.5 * LAMPORTS_PER_SOL
    );

    // Create test NFT
    console.log("\n  Creating test NFT mint...");
    nftMint = await createMint(
      connection,
      seller,
      seller.publicKey,
      null,
      0
    );
    console.log(`    NFT Mint: ${nftMint.toBase58()}`);

    sellerNftAta = await createAssociatedTokenAccount(
      connection,
      seller,
      nftMint,
      seller.publicKey
    );
    await mintTo(connection, seller, nftMint, sellerNftAta, seller, 1);
    console.log(`    Seller ATA: ${sellerNftAta.toBase58()} (balance=1)`);

    // Create Metaplex metadata
    const [metadataPda] = getMetadataPDA(nftMint);
    const metadataIx = createMetadataV3Instruction(
      metadataPda,
      nftMint,
      seller.publicKey,
      seller.publicKey,
      seller.publicKey,
      "ER Test NFT",
      "ERTEST",
      "",
      500, // 5% royalty
      [{ address: seller.publicKey, verified: true, share: 100 }]
    );
    const { sendAndConfirmTransaction: sendAndConfirm } = await import(
      "@solana/web3.js"
    );
    const metadataTx = new Transaction().add(metadataIx);
    const metaSig = await sendAndConfirm(connection, metadataTx, [seller]);
    console.log(`    Metadata PDA: ${metadataPda.toBase58()}`);
    console.log(`    Metadata TX: ${metaSig}`);

    // Derive PDAs
    [auctionState, auctionBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("auction"),
        seller.publicKey.toBuffer(),
        nftMint.toBuffer(),
      ],
      PROGRAM_ID
    );
    console.log(`    AuctionState PDA: ${auctionState.toBase58()}`);

    [auctionVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), auctionState.toBuffer()],
      PROGRAM_ID
    );
    console.log(`    AuctionVault PDA: ${auctionVault.toBase58()}`);

    escrowNftAta = await getAssociatedTokenAddress(
      nftMint,
      auctionState,
      true
    );
    console.log(`    Escrow ATA: ${escrowNftAta.toBase58()}`);

    [bidderDepositPda] = getDepositPDA(auctionState, bidder.publicKey);
    console.log(`    BidderDeposit PDA: ${bidderDepositPda.toBase58()}`);
    console.log("");
  });

  // -----------------------------------------------------------------------
  // 1. create_auction (L1)
  // -----------------------------------------------------------------------

  it("1. create_auction (L1) — escrows NFT, inits auction state", async () => {
    console.log(
      `\n  [create_auction] reserve=${lamportsToSol(reservePrice.toNumber())} SOL, duration=${durationSeconds.toString()}s`
    );

    const tx = await l1Program.methods
      .createAuction(
        reservePrice,
        durationSeconds,
        extensionSeconds,
        extensionWindow,
        minBidIncrement
      )
      .accountsStrict({
        seller: seller.publicKey,
        nftMint: nftMint,
        sellerNftTokenAccount: sellerNftAta,
        escrowNftTokenAccount: escrowNftAta,
        auctionState: auctionState,
        auctionVault: auctionVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([seller])
      .rpc();

    console.log(`    TX: ${tx}`);

    const auction = await l1Program.account.auctionState.fetch(auctionState);
    expect(JSON.stringify(auction.status)).to.equal(
      JSON.stringify({ created: {} })
    );
    console.log(`    Status: Created ✓`);
    console.log(`    NFT escrowed ✓`);
  });

  // -----------------------------------------------------------------------
  // 2. deposit (L1) — before delegation
  // -----------------------------------------------------------------------

  it("2. deposit (L1) — bidder deposits 0.1 SOL into vault", async () => {
    const depositAmount = new BN(0.1 * LAMPORTS_PER_SOL);
    console.log(
      `\n  [deposit] bidder=${bidder.publicKey.toBase58().slice(0, 8)}... amount=${lamportsToSol(depositAmount.toNumber())} SOL`
    );

    const tx = await l1Program.methods
      .deposit(depositAmount)
      .accountsStrict({
        bidder: bidder.publicKey,
        auctionState: auctionState,
        bidderDeposit: bidderDepositPda,
        auctionVault: auctionVault,
        systemProgram: SystemProgram.programId,
      })
      .signers([bidder])
      .rpc();

    console.log(`    TX: ${tx}`);

    const deposit = await l1Program.account.bidderDeposit.fetch(
      bidderDepositPda
    );
    expect(deposit.amount.toNumber()).to.equal(depositAmount.toNumber());
    console.log(
      `    BidderDeposit: ${lamportsToSol(deposit.amount.toNumber())} SOL ✓`
    );
  });

  // -----------------------------------------------------------------------
  // 3. start_auction (L1)
  // -----------------------------------------------------------------------

  it("3. start_auction (L1) — sets status to Active", async () => {
    console.log("\n  [start_auction]");

    const tx = await l1Program.methods
      .startAuction()
      .accountsStrict({
        seller: seller.publicKey,
        auctionState: auctionState,
      })
      .signers([seller])
      .rpc();

    console.log(`    TX: ${tx}`);

    const auction = await l1Program.account.auctionState.fetch(auctionState);
    expect(JSON.stringify(auction.status)).to.equal(
      JSON.stringify({ active: {} })
    );
    console.log(`    Status: Active ✓`);

    const endStr = new Date(auction.endTime.toNumber() * 1000).toISOString();
    console.log(`    End time: ${endStr}`);
  });

  // -----------------------------------------------------------------------
  // 4. delegate_auction (L1 → ER)
  // -----------------------------------------------------------------------

  it("4. delegate_auction (L1) — delegates AuctionState to ER", async () => {
    console.log("\n  [delegate_auction]");

    const [bufferPda] = getDelegationBufferPDA(auctionState);
    const [delegationRecord] = getDelegationRecordPDA(auctionState);
    const [delegationMetadata] = getDelegationMetadataPDA(auctionState);

    console.log(`    Buffer PDA: ${bufferPda.toBase58()}`);
    console.log(`    Delegation Record: ${delegationRecord.toBase58()}`);
    console.log(`    Delegation Metadata: ${delegationMetadata.toBase58()}`);

    const tx = await l1Program.methods
      .delegateAuction(nftMint)
      .accountsStrict({
        seller: seller.publicKey,
        auctionState: auctionState,
        bufferAuctionState: bufferPda,
        delegationRecordAuctionState: delegationRecord,
        delegationMetadataAuctionState: delegationMetadata,
        ownerProgram: PROGRAM_ID,
        delegationProgram: DELEGATION_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([seller])
      .rpc({ skipPreflight: true });

    console.log(`    TX: ${tx}`);

    // Verify delegation record exists
    const recordInfo = await connection.getAccountInfo(delegationRecord);
    expect(recordInfo).to.not.be.null;
    console.log(`    Delegation record exists ✓`);

    // AuctionState owner should now be the delegation program
    const stateInfo = await connection.getAccountInfo(auctionState);
    expect(stateInfo).to.not.be.null;
    expect(stateInfo!.owner.toBase58()).to.equal(
      DELEGATION_PROGRAM_ID.toBase58()
    );
    console.log(`    AuctionState owner: Delegation Program ✓`);

    // Wait for ER to pick up the delegated account
    console.log("    Waiting 3s for ER to sync...");
    await sleep(3000);
  });

  // -----------------------------------------------------------------------
  // 5. place_bid (ER) — routed through Magic Router
  // -----------------------------------------------------------------------

  it("5. place_bid (ER) — bidder bids 0.05 SOL via Ephemeral Rollup", async () => {
    const bidAmount = new BN(0.05 * LAMPORTS_PER_SOL);
    console.log(
      `\n  [place_bid via ER] amount=${lamportsToSol(bidAmount.toNumber())} SOL`
    );

    const methodBuilder = erProgram.methods
      .placeBid(bidAmount)
      .accountsStrict({
        bidder: bidder.publicKey,
        auctionState: auctionState,
      });

    const sig = await sendErTransaction(
      erProgram,
      methodBuilder,
      bidder,
      magicConnection
    );

    console.log(`    TX: ${sig}`);

    // Fetch state from Magic Router (ER has the live state)
    const auction = await erProgram.account.auctionState.fetch(auctionState);
    expect(auction.currentBid.toNumber()).to.equal(bidAmount.toNumber());
    expect(auction.highestBidder.toBase58()).to.equal(
      bidder.publicKey.toBase58()
    );
    expect(auction.bidCount).to.equal(1);
    console.log(
      `    Current bid: ${lamportsToSol(auction.currentBid.toNumber())} SOL ✓`
    );
    console.log(
      `    Highest bidder: ${auction.highestBidder.toBase58().slice(0, 8)}... ✓`
    );
    console.log(`    Bid count: ${auction.bidCount} ✓`);
    console.log(`    Bid processed on ER ✓`);
  });

  // -----------------------------------------------------------------------
  // 6. Wait for auction timer to expire
  // -----------------------------------------------------------------------

  it("6. wait for auction timer to expire", async () => {
    // Fetch from ER since that has the live state
    const auction = await erProgram.account.auctionState.fetch(auctionState);
    const now = Math.floor(Date.now() / 1000);
    const endTime = auction.endTime.toNumber();
    const waitSeconds = endTime - now + 3;

    if (waitSeconds > 0) {
      console.log(
        `\n  [wait] Auction ends at ${new Date(endTime * 1000).toISOString()}`
      );
      console.log(`    Waiting ${waitSeconds}s...`);
      await sleep(waitSeconds * 1000);
    } else {
      console.log("\n  [wait] Auction already expired");
    }

    console.log("    Timer expired ✓");
  });

  // -----------------------------------------------------------------------
  // 7. end_auction (ER)
  // -----------------------------------------------------------------------

  it("7. end_auction (ER) — sets status to Ended on Ephemeral Rollup", async () => {
    console.log("\n  [end_auction via ER]");

    const methodBuilder = erProgram.methods
      .endAuction()
      .accountsStrict({
        authority: seller.publicKey,
        auctionState: auctionState,
      });

    const sig = await sendErTransaction(
      erProgram,
      methodBuilder,
      seller,
      magicConnection
    );

    console.log(`    TX: ${sig}`);

    // Fetch from ER
    const auction = await erProgram.account.auctionState.fetch(auctionState);
    expect(JSON.stringify(auction.status)).to.equal(
      JSON.stringify({ ended: {} })
    );
    console.log(`    Status: Ended ✓`);
    console.log(
      `    Winner: ${auction.highestBidder.toBase58().slice(0, 8)}...`
    );
    console.log(
      `    Winning bid: ${lamportsToSol(auction.currentBid.toNumber())} SOL`
    );
  });

  // -----------------------------------------------------------------------
  // 8. undelegate_auction (ER → L1)
  // -----------------------------------------------------------------------

  it("8. undelegate_auction (ER→L1) — commits state back to L1", async () => {
    console.log("\n  [undelegate_auction]");

    const methodBuilder = erProgram.methods
      .undelegateAuction()
      .accountsStrict({
        payer: seller.publicKey,
        auctionState: auctionState,
        magicProgram: MAGIC_PROGRAM_ID,
        magicContext: MAGIC_CONTEXT_ID,
      });

    const sig = await sendErTransaction(
      erProgram,
      methodBuilder,
      seller,
      magicConnection
    );

    console.log(`    TX: ${sig}`);

    // Wait for undelegation to propagate to L1
    console.log("    Waiting 5s for L1 state commitment...");
    await sleep(5000);

    // Verify AuctionState owner is back to Outcry program on L1
    let stateInfo = await connection.getAccountInfo(auctionState);

    // Poll a few times if owner hasn't changed yet
    for (let i = 0; i < 10 && stateInfo?.owner.toBase58() !== PROGRAM_ID.toBase58(); i++) {
      console.log(`    Polling L1 state (attempt ${i + 1})...`);
      await sleep(3000);
      stateInfo = await connection.getAccountInfo(auctionState);
    }

    expect(stateInfo).to.not.be.null;
    expect(stateInfo!.owner.toBase58()).to.equal(PROGRAM_ID.toBase58());
    console.log(`    AuctionState owner: Outcry Program ✓`);

    // Verify state was committed correctly
    const auction = await l1Program.account.auctionState.fetch(auctionState);
    expect(JSON.stringify(auction.status)).to.equal(
      JSON.stringify({ ended: {} })
    );
    expect(auction.currentBid.toNumber()).to.equal(0.05 * LAMPORTS_PER_SOL);
    expect(auction.highestBidder.toBase58()).to.equal(
      bidder.publicKey.toBase58()
    );
    expect(auction.bidCount).to.equal(1);
    console.log(`    Status: Ended ✓`);
    console.log(
      `    Bid data committed: ${lamportsToSol(auction.currentBid.toNumber())} SOL, ${auction.bidCount} bids ✓`
    );
  });

  // -----------------------------------------------------------------------
  // 9. settle_auction (L1)
  // -----------------------------------------------------------------------

  it("9. settle_auction (L1) — transfers NFT to winner, SOL to seller, fees to treasury", async () => {
    console.log("\n  [settle_auction]");

    const sellerBalBefore = await connection.getBalance(seller.publicKey);
    const winnerNftAta = await getAssociatedTokenAddress(
      nftMint,
      bidder.publicKey
    );

    const [nftMetadata] = getMetadataPDA(nftMint);
    const [winnerDepositPda] = getDepositPDA(auctionState, bidder.publicKey);

    const tx = await l1Program.methods
      .settleAuction()
      .accountsStrict({
        payer: seller.publicKey,
        auctionState: auctionState,
        auctionVault: auctionVault,
        winnerDeposit: winnerDepositPda,
        seller: seller.publicKey,
        winner: bidder.publicKey,
        protocolTreasury: PROTOCOL_TREASURY,
        nftMint: nftMint,
        nftMetadata: nftMetadata,
        escrowNftTokenAccount: escrowNftAta,
        winnerNftTokenAccount: winnerNftAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([
        { pubkey: seller.publicKey, isSigner: false, isWritable: true },
      ])
      .signers([seller])
      .rpc();

    console.log(`    TX: ${tx}`);

    const auction = await l1Program.account.auctionState.fetch(auctionState);
    expect(JSON.stringify(auction.status)).to.equal(
      JSON.stringify({ settled: {} })
    );
    console.log(`    Status: Settled ✓`);

    const winnerNftAccount = await getAccount(connection, winnerNftAta);
    expect(Number(winnerNftAccount.amount)).to.equal(1);
    console.log(`    Winner NFT balance: 1 ✓`);

    // Verify settlement math:
    // winning_bid = 0.05 SOL, royalties = 5% = 2,500,000, protocol_fee = 2.5% = 1,250,000
    // seller_receives = 50,000,000 - 2,500,000 - 1,250,000 = 46,250,000
    // NOTE: seller == creator == treasury in this test, so combined inflow = 50,000,000
    const sellerBalAfter = await connection.getBalance(seller.publicKey);
    const sellerGain = sellerBalAfter - sellerBalBefore;
    console.log(
      `    Seller/Treasury net change: ${sellerGain > 0 ? "+" : ""}${lamportsToSol(sellerGain)} SOL`
    );
    expect(sellerGain).to.be.greaterThan(0.045 * LAMPORTS_PER_SOL);
    expect(sellerGain).to.be.lessThanOrEqual(0.05 * LAMPORTS_PER_SOL);
    console.log(`    Settlement math verified ✓`);

    const deposit = await l1Program.account.bidderDeposit.fetch(
      winnerDepositPda
    );
    expect(deposit.amount.toNumber()).to.equal(0.05 * LAMPORTS_PER_SOL);
    console.log(
      `    Winner remaining deposit: ${lamportsToSol(deposit.amount.toNumber())} SOL ✓`
    );
  });

  // -----------------------------------------------------------------------
  // 10. claim_refund (L1)
  // -----------------------------------------------------------------------

  it("10. claim_refund (L1) — winner claims remaining 0.05 SOL deposit", async () => {
    console.log("\n  [claim_refund]");

    const bidderBalBefore = await connection.getBalance(bidder.publicKey);

    const tx = await l1Program.methods
      .claimRefund()
      .accountsStrict({
        bidder: bidder.publicKey,
        auctionState: auctionState,
        bidderDeposit: bidderDepositPda,
        auctionVault: auctionVault,
        systemProgram: SystemProgram.programId,
      })
      .signers([bidder])
      .rpc();

    console.log(`    TX: ${tx}`);

    const bidderBalAfter = await connection.getBalance(bidder.publicKey);
    const refund = bidderBalAfter - bidderBalBefore;
    console.log(`    Bidder balance change: +${lamportsToSol(refund)} SOL`);
    expect(refund).to.be.greaterThan(0.04 * LAMPORTS_PER_SOL);
    console.log(`    Refund received ✓`);
  });

  // -----------------------------------------------------------------------
  // 11. close_auction (L1)
  // -----------------------------------------------------------------------

  it("11. close_auction (L1) — seller reclaims rent", async () => {
    console.log("\n  [close_auction]");

    const sellerBalBefore = await connection.getBalance(seller.publicKey);

    const tx = await l1Program.methods
      .closeAuction()
      .accountsStrict({
        seller: seller.publicKey,
        auctionState: auctionState,
        auctionVault: auctionVault,
        nftMint: nftMint,
        escrowNftTokenAccount: escrowNftAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([seller])
      .rpc();

    console.log(`    TX: ${tx}`);

    const sellerBalAfter = await connection.getBalance(seller.publicKey);
    const rentRecovered = sellerBalAfter - sellerBalBefore;
    console.log(`    Rent recovered: +${lamportsToSol(rentRecovered)} SOL`);
    expect(rentRecovered).to.be.greaterThan(0);

    const auctionInfo = await connection.getAccountInfo(auctionState);
    expect(auctionInfo).to.be.null;
    console.log(`    AuctionState: null ✓`);
    console.log(`    Accounts closed ✓`);
  });

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------

  after(async () => {
    console.log("\n=== Devnet ER E2E Complete ===");
    console.log(`  NFT Mint:       ${nftMint?.toBase58()}`);
    console.log(`  AuctionState:   ${auctionState?.toBase58()}`);
    console.log(
      `  Seller balance: ${lamportsToSol(await connection.getBalance(seller.publicKey))} SOL`
    );
    console.log(
      `  Bidder balance: ${lamportsToSol(await connection.getBalance(bidder.publicKey))} SOL`
    );
    console.log("");
  });
});
