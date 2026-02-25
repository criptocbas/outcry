/**
 * OUTCRY — Devnet End-to-End Test
 *
 * Runs the full L1 auction lifecycle against the deployed program on Solana devnet.
 * Tests BidderDeposit PDA architecture (no Vec-based deposits).
 *
 * Usage:
 *   npx ts-mocha -p ./tsconfig.json -t 1000000 tests/devnet-e2e.ts
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
  TransactionInstruction,
  LAMPORTS_PER_SOL,
  SYSVAR_RENT_PUBKEY,
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
import { expect } from "chai";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROGRAM_ID = new PublicKey(
  "J7r5mzvVUjSNQteoqn6Hd3LjZ3ksmwoD5xsnUvMJwPZo"
);

const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

const PROTOCOL_TREASURY = new PublicKey(
  "B6MtVeqn7BrJ8HTX6CeP8VugNWyCqqbfcDMxYBknzPt7"
);

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getMetadataPDA(nftMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      nftMint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
}

function getDepositPDA(
  auctionState: PublicKey,
  bidder: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("deposit"), auctionState.toBuffer(), bidder.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * Build a CreateMetadataAccountV3 instruction for the Token Metadata program.
 * Constructs the Borsh-serialized instruction data manually to avoid adding
 * @metaplex-foundation/mpl-token-metadata as a dependency.
 */
function createMetadataV3Instruction(
  metadataPda: PublicKey,
  mint: PublicKey,
  mintAuthority: PublicKey,
  payer: PublicKey,
  updateAuthority: PublicKey,
  name: string,
  symbol: string,
  uri: string,
  sellerFeeBasisPoints: number,
  creators: { address: PublicKey; verified: boolean; share: number }[]
): TransactionInstruction {
  // Borsh-encode the instruction data for CreateMetadataAccountV3
  // Discriminator = 33
  const nameBytes = Buffer.from(name, "utf-8");
  const symbolBytes = Buffer.from(symbol, "utf-8");
  const uriBytes = Buffer.from(uri, "utf-8");

  const parts: Buffer[] = [];

  // Discriminator
  parts.push(Buffer.from([33]));

  // DataV2.name (borsh string = 4-byte LE len + bytes)
  const nameLenBuf = Buffer.alloc(4);
  nameLenBuf.writeUInt32LE(nameBytes.length);
  parts.push(nameLenBuf);
  parts.push(nameBytes);

  // DataV2.symbol
  const symbolLenBuf = Buffer.alloc(4);
  symbolLenBuf.writeUInt32LE(symbolBytes.length);
  parts.push(symbolLenBuf);
  parts.push(symbolBytes);

  // DataV2.uri
  const uriLenBuf = Buffer.alloc(4);
  uriLenBuf.writeUInt32LE(uriBytes.length);
  parts.push(uriLenBuf);
  parts.push(uriBytes);

  // DataV2.seller_fee_basis_points (u16 LE)
  const feeBuf = Buffer.alloc(2);
  feeBuf.writeUInt16LE(sellerFeeBasisPoints);
  parts.push(feeBuf);

  // DataV2.creators: Option<Vec<Creator>>
  if (creators.length > 0) {
    parts.push(Buffer.from([1])); // Some
    const countBuf = Buffer.alloc(4);
    countBuf.writeUInt32LE(creators.length);
    parts.push(countBuf);
    for (const c of creators) {
      parts.push(c.address.toBuffer()); // 32 bytes
      parts.push(Buffer.from([c.verified ? 1 : 0])); // 1 byte
      parts.push(Buffer.from([c.share])); // 1 byte
    }
  } else {
    parts.push(Buffer.from([0])); // None
  }

  // DataV2.collection: None
  parts.push(Buffer.from([0]));

  // DataV2.uses: None
  parts.push(Buffer.from([0]));

  // is_mutable: true
  parts.push(Buffer.from([1]));

  // collection_details: None
  parts.push(Buffer.from([0]));

  const data = Buffer.concat(parts);

  return new TransactionInstruction({
    programId: TOKEN_METADATA_PROGRAM_ID,
    keys: [
      { pubkey: metadataPda, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: mintAuthority, isSigner: true, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: updateAuthority, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

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
  const { Transaction, sendAndConfirmTransaction } = await import(
    "@solana/web3.js"
  );
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

describe("outcry devnet e2e", function () {
  this.timeout(600_000); // 10 minutes — devnet can be slow

  // Connection + provider
  const connection = new Connection(DEVNET_RPC, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60_000,
  });

  // Seller = deployer wallet
  const seller = loadKeypair("~/.config/solana/id.json");
  const wallet = new Wallet(seller);
  const provider = new AnchorProvider(connection, wallet, {
    preflightCommitment: "confirmed",
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  // Program from IDL
  const idl = loadIdl();
  const program = new Program(idl, provider) as any;

  // Bidder = freshly generated keypair
  const bidder = Keypair.generate();

  // NFT + PDA addresses — set during test
  let nftMint: PublicKey;
  let sellerNftAta: PublicKey;
  let auctionState: PublicKey;
  let auctionBump: number;
  let auctionVault: PublicKey;
  let escrowNftAta: PublicKey;
  let bidderDepositPda: PublicKey;

  // Auction params — small amounts to conserve devnet SOL
  const reservePrice = new BN(0.05 * LAMPORTS_PER_SOL); // 0.05 SOL
  const durationSeconds = new BN(10); // 10 seconds
  const extensionSeconds = 5;
  const extensionWindow = 5;
  const minBidIncrement = new BN(0.01 * LAMPORTS_PER_SOL); // 0.01 SOL

  // -----------------------------------------------------------------------
  // Setup
  // -----------------------------------------------------------------------

  before(async () => {
    console.log("\n=== OUTCRY Devnet E2E Test ===");
    console.log(`  Program:  ${PROGRAM_ID.toBase58()}`);
    console.log(`  RPC:      ${DEVNET_RPC.slice(0, 50)}...`);
    console.log(`  Seller:   ${seller.publicKey.toBase58()}`);
    console.log(`  Bidder:   ${bidder.publicKey.toBase58()}`);
    console.log("");

    // Check seller balance
    const sellerBal = await connection.getBalance(seller.publicKey);
    console.log(`  Seller balance: ${lamportsToSol(sellerBal)} SOL`);
    expect(sellerBal).to.be.greaterThan(
      1 * LAMPORTS_PER_SOL,
      "Seller needs at least 1 SOL"
    );

    // Fund bidder from seller wallet
    await fundFromWallet(
      connection,
      seller,
      bidder.publicKey,
      0.5 * LAMPORTS_PER_SOL
    );

    // --- Create test NFT (0-decimal mint = NFT) ---
    console.log("\n  Creating test NFT mint...");
    nftMint = await createMint(
      connection,
      seller,
      seller.publicKey, // mint authority
      null, // freeze authority
      0 // decimals
    );
    console.log(`    NFT Mint: ${nftMint.toBase58()}`);

    // Create seller's ATA and mint 1 NFT
    sellerNftAta = await createAssociatedTokenAccount(
      connection,
      seller,
      nftMint,
      seller.publicKey
    );
    await mintTo(connection, seller, nftMint, sellerNftAta, seller, 1);
    console.log(`    Seller ATA: ${sellerNftAta.toBase58()} (balance=1)`);

    // --- Create Metaplex metadata (required by settle_auction for royalty parsing) ---
    const [metadataPda] = getMetadataPDA(nftMint);
    const metadataIx = createMetadataV3Instruction(
      metadataPda,
      nftMint,
      seller.publicKey, // mint authority
      seller.publicKey, // payer
      seller.publicKey, // update authority
      "Test NFT",
      "TEST",
      "", // no URI needed for testing
      500, // 5% seller fee (royalty)
      [{ address: seller.publicKey, verified: true, share: 100 }]
    );
    const { Transaction: SolTx, sendAndConfirmTransaction: sendAndConfirm } =
      await import("@solana/web3.js");
    const metadataTx = new SolTx().add(metadataIx);
    const metaSig = await sendAndConfirm(connection, metadataTx, [seller]);
    console.log(`    Metadata PDA: ${metadataPda.toBase58()}`);
    console.log(`    Metadata TX: ${metaSig}`);

    // --- Derive PDAs ---
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
      true // allowOwnerOffCurve (PDA)
    );
    console.log(`    Escrow ATA: ${escrowNftAta.toBase58()}`);

    [bidderDepositPda] = getDepositPDA(auctionState, bidder.publicKey);
    console.log(`    BidderDeposit PDA: ${bidderDepositPda.toBase58()}`);
    console.log("");
  });

  // -----------------------------------------------------------------------
  // 1. create_auction
  // -----------------------------------------------------------------------

  it("1. create_auction — escrows NFT, inits auction state", async () => {
    console.log(
      `\n  [create_auction] reserve=${lamportsToSol(reservePrice.toNumber())} SOL, duration=${durationSeconds.toString()}s`
    );

    const tx = await program.methods
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

    // Verify state
    const auction = await program.account.auctionState.fetch(auctionState);
    expect(auction.seller.toBase58()).to.equal(seller.publicKey.toBase58());
    expect(auction.nftMint.toBase58()).to.equal(nftMint.toBase58());
    expect(auction.reservePrice.toNumber()).to.equal(reservePrice.toNumber());
    expect(auction.currentBid.toNumber()).to.equal(0);
    expect(auction.bidCount).to.equal(0);
    expect(JSON.stringify(auction.status)).to.equal(
      JSON.stringify({ created: {} })
    );
    console.log(`    Status: Created ✓`);

    // NFT should be in escrow
    const escrowAccount = await getAccount(connection, escrowNftAta);
    expect(Number(escrowAccount.amount)).to.equal(1);
    console.log(`    NFT escrowed ✓`);

    const sellerAccount = await getAccount(connection, sellerNftAta);
    expect(Number(sellerAccount.amount)).to.equal(0);
    console.log(`    Seller NFT balance: 0 ✓`);
  });

  // -----------------------------------------------------------------------
  // 2. deposit — bidder deposits SOL via BidderDeposit PDA
  // -----------------------------------------------------------------------

  it("2. deposit — bidder deposits 0.1 SOL into vault", async () => {
    const depositAmount = new BN(0.1 * LAMPORTS_PER_SOL);
    console.log(
      `\n  [deposit] bidder=${bidder.publicKey.toBase58().slice(0, 8)}... amount=${lamportsToSol(depositAmount.toNumber())} SOL`
    );

    const tx = await program.methods
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

    // Verify BidderDeposit PDA
    const deposit = await program.account.bidderDeposit.fetch(bidderDepositPda);
    expect(deposit.auction.toBase58()).to.equal(auctionState.toBase58());
    expect(deposit.bidder.toBase58()).to.equal(bidder.publicKey.toBase58());
    expect(deposit.amount.toNumber()).to.equal(depositAmount.toNumber());
    console.log(
      `    BidderDeposit: ${lamportsToSol(deposit.amount.toNumber())} SOL ✓`
    );

    // Verify vault received SOL
    const vaultBal = await connection.getBalance(auctionVault);
    console.log(`    Vault balance: ${lamportsToSol(vaultBal)} SOL`);
  });

  // -----------------------------------------------------------------------
  // 3. start_auction
  // -----------------------------------------------------------------------

  it("3. start_auction — sets status to Active", async () => {
    console.log("\n  [start_auction]");

    const tx = await program.methods
      .startAuction()
      .accountsStrict({
        seller: seller.publicKey,
        auctionState: auctionState,
      })
      .signers([seller])
      .rpc();

    console.log(`    TX: ${tx}`);

    const auction = await program.account.auctionState.fetch(auctionState);
    expect(JSON.stringify(auction.status)).to.equal(
      JSON.stringify({ active: {} })
    );
    expect(auction.startTime.toNumber()).to.be.greaterThan(0);
    expect(auction.endTime.toNumber()).to.be.greaterThan(
      auction.startTime.toNumber()
    );

    const endStr = new Date(auction.endTime.toNumber() * 1000).toISOString();
    console.log(`    Status: Active ✓`);
    console.log(`    End time: ${endStr}`);
  });

  // -----------------------------------------------------------------------
  // 4. place_bid — bidder bids at reserve price (L1, not ER)
  // -----------------------------------------------------------------------

  it("4. place_bid — bidder bids 0.05 SOL (reserve price)", async () => {
    const bidAmount = new BN(0.05 * LAMPORTS_PER_SOL);
    console.log(
      `\n  [place_bid] amount=${lamportsToSol(bidAmount.toNumber())} SOL`
    );

    const tx = await program.methods
      .placeBid(bidAmount)
      .accountsStrict({
        bidder: bidder.publicKey,
        auctionState: auctionState,
      })
      .signers([bidder])
      .rpc();

    console.log(`    TX: ${tx}`);

    const auction = await program.account.auctionState.fetch(auctionState);
    expect(auction.currentBid.toNumber()).to.equal(bidAmount.toNumber());
    expect(auction.highestBidder.toBase58()).to.equal(
      bidder.publicKey.toBase58()
    );
    expect(auction.bidCount).to.equal(1);
    console.log(
      `    Current bid: ${lamportsToSol(auction.currentBid.toNumber())} SOL ✓`
    );
    console.log(`    Highest bidder: ${auction.highestBidder.toBase58().slice(0, 8)}... ✓`);
    console.log(`    Bid count: ${auction.bidCount} ✓`);
  });

  // -----------------------------------------------------------------------
  // 5. Wait for auction to end
  // -----------------------------------------------------------------------

  it("5. wait for auction timer to expire", async () => {
    const auction = await program.account.auctionState.fetch(auctionState);
    const now = Math.floor(Date.now() / 1000);
    const endTime = auction.endTime.toNumber();
    const waitSeconds = endTime - now + 3; // +3s buffer

    if (waitSeconds > 0) {
      console.log(
        `\n  [wait] Auction ends at ${new Date(endTime * 1000).toISOString()}`
      );
      console.log(`    Waiting ${waitSeconds}s...`);
      await sleep(waitSeconds * 1000);
    } else {
      console.log("\n  [wait] Auction already expired");
    }

    const nowAfter = Math.floor(Date.now() / 1000);
    expect(nowAfter).to.be.greaterThanOrEqual(endTime);
    console.log("    Timer expired ✓");
  });

  // -----------------------------------------------------------------------
  // 6. end_auction
  // -----------------------------------------------------------------------

  it("6. end_auction — sets status to Ended", async () => {
    console.log("\n  [end_auction]");

    const tx = await program.methods
      .endAuction()
      .accountsStrict({
        authority: seller.publicKey,
        auctionState: auctionState,
      })
      .signers([seller])
      .rpc();

    console.log(`    TX: ${tx}`);

    const auction = await program.account.auctionState.fetch(auctionState);
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
  // 7. settle_auction — NFT to winner, SOL to seller
  // -----------------------------------------------------------------------

  it("7. settle_auction — transfers NFT to winner, SOL to seller, fees to treasury", async () => {
    console.log("\n  [settle_auction]");

    const sellerBalBefore = await connection.getBalance(seller.publicKey);
    const winnerNftAta = await getAssociatedTokenAddress(
      nftMint,
      bidder.publicKey
    );

    // Derive metadata PDA (Metaplex Token Metadata)
    const [nftMetadata] = getMetadataPDA(nftMint);
    console.log(`    NFT Metadata PDA: ${nftMetadata.toBase58()}`);

    // Winner's BidderDeposit PDA
    const [winnerDepositPda] = getDepositPDA(auctionState, bidder.publicKey);
    console.log(`    Winner Deposit PDA: ${winnerDepositPda.toBase58()}`);

    // Pass creator accounts via remainingAccounts (seller is the sole creator)
    const tx = await program.methods
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

    // Verify status
    const auction = await program.account.auctionState.fetch(auctionState);
    expect(JSON.stringify(auction.status)).to.equal(
      JSON.stringify({ settled: {} })
    );
    console.log(`    Status: Settled ✓`);

    // Verify NFT transferred to winner
    const winnerNftAccount = await getAccount(connection, winnerNftAta);
    expect(Number(winnerNftAccount.amount)).to.equal(1);
    console.log(`    Winner NFT balance: 1 ✓`);

    // Verify escrow is empty
    const escrowAccount = await getAccount(connection, escrowNftAta);
    expect(Number(escrowAccount.amount)).to.equal(0);
    console.log(`    Escrow NFT balance: 0 ✓`);

    // Verify settlement math:
    // winning_bid = 0.05 SOL = 50,000,000 lamports
    // royalties   = 50,000,000 × 500/10000 = 2,500,000 (5% to creator = seller)
    // protocol_fee = 50,000,000 × 250/10000 = 1,250,000 (2.5% to treasury = seller)
    // seller_receives = 50,000,000 - 2,500,000 - 1,250,000 = 46,250,000
    //
    // NOTE: seller == creator == treasury in this test, so total inflow to seller:
    // 46,250,000 + 2,500,000 + 1,250,000 = 50,000,000 (the full winning bid)
    // Net change = 50,000,000 - tx_fee - winner_ATA_rent
    const sellerBalAfter = await connection.getBalance(seller.publicKey);
    const sellerGain = sellerBalAfter - sellerBalBefore;
    const expectedProtocolFee = 1_250_000;
    const expectedRoyalties = 2_500_000;
    const expectedSellerReceives = 46_250_000;
    console.log(
      `    Expected: seller_receives=${lamportsToSol(expectedSellerReceives)}, royalties=${lamportsToSol(expectedRoyalties)}, protocol_fee=${lamportsToSol(expectedProtocolFee)} SOL`
    );
    console.log(
      `    Seller/Treasury net change: ${sellerGain > 0 ? "+" : ""}${lamportsToSol(sellerGain)} SOL`
    );
    // seller == treasury == creator, so they receive the full winning bid minus tx costs
    // Approximate check: gain should be close to 0.05 SOL (minus tx fee + ATA rent)
    expect(sellerGain).to.be.greaterThan(0.045 * LAMPORTS_PER_SOL);
    expect(sellerGain).to.be.lessThanOrEqual(0.05 * LAMPORTS_PER_SOL);
    console.log(`    Settlement math verified ✓`);

    // Verify winner's deposit was deducted (0.1 - 0.05 = 0.05 remaining)
    const deposit = await program.account.bidderDeposit.fetch(winnerDepositPda);
    const expectedRemaining = 0.05 * LAMPORTS_PER_SOL;
    expect(deposit.amount.toNumber()).to.equal(expectedRemaining);
    console.log(
      `    Winner remaining deposit: ${lamportsToSol(deposit.amount.toNumber())} SOL ✓`
    );
  });

  // -----------------------------------------------------------------------
  // 8. claim_refund — winner claims remaining deposit
  // -----------------------------------------------------------------------

  it("8. claim_refund — winner claims remaining 0.05 SOL deposit", async () => {
    console.log("\n  [claim_refund]");

    const bidderBalBefore = await connection.getBalance(bidder.publicKey);

    const tx = await program.methods
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
    console.log(
      `    Bidder balance change: +${lamportsToSol(refund)} SOL`
    );
    // Should receive ~0.05 SOL back minus tx fee
    expect(refund).to.be.greaterThan(0.04 * LAMPORTS_PER_SOL);
    console.log(`    Refund received ✓`);

    // Deposit PDA should be closed (rent returned to bidder)
    const depositAccount = await connection.getAccountInfo(bidderDepositPda);
    expect(depositAccount).to.be.null;
    console.log(`    Deposit PDA closed ✓`);
  });

  // -----------------------------------------------------------------------
  // 9. close_auction — reclaim rent
  // -----------------------------------------------------------------------

  it("9. close_auction — seller reclaims rent from accounts", async () => {
    console.log("\n  [close_auction]");

    const sellerBalBefore = await connection.getBalance(seller.publicKey);

    const tx = await program.methods
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
    console.log(
      `    Rent recovered: +${lamportsToSol(rentRecovered)} SOL`
    );
    expect(rentRecovered).to.be.greaterThan(0);
    console.log(`    Accounts closed ✓`);

    // Verify accounts are gone
    const auctionInfo = await connection.getAccountInfo(auctionState);
    expect(auctionInfo).to.be.null;
    console.log(`    AuctionState: null ✓`);

    const vaultInfo = await connection.getAccountInfo(auctionVault);
    expect(vaultInfo).to.be.null;
    console.log(`    AuctionVault: null ✓`);
  });

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------

  after(async () => {
    console.log("\n=== Devnet E2E Complete ===");
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
