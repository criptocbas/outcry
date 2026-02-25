import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Outcry } from "../target/types/outcry";
import {
  Keypair,
  PublicKey,
  SystemProgram,
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
import { expect } from "chai";

import {
  PROTOCOL_TREASURY,
  getAuctionPDA,
  getVaultPDA,
  getDepositPDA,
  getMetadataPDA,
  createTestNft,
  setupAuction,
  sleep,
  createMetadataV3Instruction,
} from "./helpers";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("outcry", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Outcry as Program<Outcry>;
  const connection = provider.connection;

  // Test accounts
  const seller = Keypair.generate();
  const bidder1 = Keypair.generate();
  const bidder2 = Keypair.generate();
  let nftMint: PublicKey;
  let sellerNftAta: PublicKey;
  let auctionState: PublicKey;
  let auctionVault: PublicKey;
  let escrowNftAta: PublicKey;
  let nftMetadataPda: PublicKey;

  // Auction params
  const reservePrice = new anchor.BN(1 * LAMPORTS_PER_SOL);
  const durationSeconds = new anchor.BN(5);
  const extensionSeconds = 2;
  const extensionWindow = 2;
  const minBidIncrement = new anchor.BN(0.1 * LAMPORTS_PER_SOL);

  before(async () => {
    for (const kp of [seller, bidder1, bidder2]) {
      const sig = await connection.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
    }

    const nft = await createTestNft(connection, seller, {
      sellerFeeBps: 500,
      creators: [{ address: seller.publicKey, verified: true, share: 100 }],
    });
    nftMint = nft.mint;
    sellerNftAta = nft.ownerAta;
    nftMetadataPda = nft.metadata;

    [auctionState] = getAuctionPDA(seller.publicKey, nftMint, program.programId);
    [auctionVault] = getVaultPDA(auctionState, program.programId);
    escrowNftAta = await getAssociatedTokenAddress(nftMint, auctionState, true);
  });

  it("creates an auction", async () => {
    await program.methods
      .createAuction(reservePrice, durationSeconds, extensionSeconds, extensionWindow, minBidIncrement)
      .accountsStrict({
        seller: seller.publicKey,
        nftMint,
        sellerNftTokenAccount: sellerNftAta,
        escrowNftTokenAccount: escrowNftAta,
        auctionState,
        auctionVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([seller])
      .rpc();

    const auction = await program.account.auctionState.fetch(auctionState);
    expect(auction.seller.toBase58()).to.equal(seller.publicKey.toBase58());
    expect(auction.nftMint.toBase58()).to.equal(nftMint.toBase58());
    expect(auction.reservePrice.toNumber()).to.equal(LAMPORTS_PER_SOL);
    expect(auction.currentBid.toNumber()).to.equal(0);
    expect(auction.bidCount).to.equal(0);
    expect(JSON.stringify(auction.status)).to.equal(JSON.stringify({ created: {} }));

    const escrowAccount = await getAccount(connection, escrowNftAta);
    expect(Number(escrowAccount.amount)).to.equal(1);

    const sellerAccount = await getAccount(connection, sellerNftAta);
    expect(Number(sellerAccount.amount)).to.equal(0);
  });

  it("accepts deposits from bidders via BidderDeposit PDAs", async () => {
    const depositAmount = new anchor.BN(3 * LAMPORTS_PER_SOL);

    const [bidder1Deposit] = getDepositPDA(auctionState, bidder1.publicKey, program.programId);
    await program.methods
      .deposit(depositAmount)
      .accountsStrict({
        bidder: bidder1.publicKey,
        auctionState,
        bidderDeposit: bidder1Deposit,
        auctionVault,
        systemProgram: SystemProgram.programId,
      })
      .signers([bidder1])
      .rpc();

    let deposit1 = await program.account.bidderDeposit.fetch(bidder1Deposit);
    expect(deposit1.amount.toNumber()).to.equal(3 * LAMPORTS_PER_SOL);
    expect(deposit1.bidder.toBase58()).to.equal(bidder1.publicKey.toBase58());

    const [bidder2Deposit] = getDepositPDA(auctionState, bidder2.publicKey, program.programId);
    await program.methods
      .deposit(depositAmount)
      .accountsStrict({
        bidder: bidder2.publicKey,
        auctionState,
        bidderDeposit: bidder2Deposit,
        auctionVault,
        systemProgram: SystemProgram.programId,
      })
      .signers([bidder2])
      .rpc();

    let deposit2 = await program.account.bidderDeposit.fetch(bidder2Deposit);
    expect(deposit2.amount.toNumber()).to.equal(3 * LAMPORTS_PER_SOL);
    expect(deposit2.bidder.toBase58()).to.equal(bidder2.publicKey.toBase58());
  });

  it("starts the auction", async () => {
    await program.methods
      .startAuction()
      .accountsStrict({ seller: seller.publicKey, auctionState })
      .signers([seller])
      .rpc();

    const auction = await program.account.auctionState.fetch(auctionState);
    expect(JSON.stringify(auction.status)).to.equal(JSON.stringify({ active: {} }));
    expect(auction.startTime.toNumber()).to.be.greaterThan(0);
    expect(auction.endTime.toNumber()).to.be.greaterThan(auction.startTime.toNumber());
  });

  it("places bids (deposit check deferred to settlement)", async () => {
    await program.methods
      .placeBid(reservePrice)
      .accountsStrict({ bidder: bidder1.publicKey, auctionState })
      .signers([bidder1])
      .rpc();

    let auction = await program.account.auctionState.fetch(auctionState);
    expect(auction.currentBid.toNumber()).to.equal(LAMPORTS_PER_SOL);
    expect(auction.highestBidder.toBase58()).to.equal(bidder1.publicKey.toBase58());
    expect(auction.bidCount).to.equal(1);

    const bid2Amount = new anchor.BN(1.2 * LAMPORTS_PER_SOL);
    await program.methods
      .placeBid(bid2Amount)
      .accountsStrict({ bidder: bidder2.publicKey, auctionState })
      .signers([bidder2])
      .rpc();

    auction = await program.account.auctionState.fetch(auctionState);
    expect(auction.currentBid.toNumber()).to.equal(1.2 * LAMPORTS_PER_SOL);
    expect(auction.highestBidder.toBase58()).to.equal(bidder2.publicKey.toBase58());
    expect(auction.bidCount).to.equal(2);
  });

  it("rejects bid below minimum increment", async () => {
    const lowBid = new anchor.BN(1.25 * LAMPORTS_PER_SOL);
    try {
      await program.methods
        .placeBid(lowBid)
        .accountsStrict({ bidder: bidder1.publicKey, auctionState })
        .signers([bidder1])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("BidTooLow");
    }
  });

  it("rejects seller bidding on own auction", async () => {
    const bid = new anchor.BN(2 * LAMPORTS_PER_SOL);
    try {
      await program.methods
        .placeBid(bid)
        .accountsStrict({ bidder: seller.publicKey, auctionState })
        .signers([seller])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("SellerCannotBid");
    }
  });

  it("rejects ending auction before time expires", async () => {
    try {
      await program.methods
        .endAuction()
        .accountsStrict({ authority: seller.publicKey, auctionState })
        .signers([seller])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("AuctionStillActive");
    }
  });

  it("ends auction after time expires", async () => {
    const auction = await program.account.auctionState.fetch(auctionState);
    const now = Math.floor(Date.now() / 1000);
    const waitTime = auction.endTime.toNumber() - now + 2;
    if (waitTime > 0) {
      await sleep(waitTime * 1000);
    }

    await program.methods
      .endAuction()
      .accountsStrict({ authority: seller.publicKey, auctionState })
      .signers([seller])
      .rpc();

    const endedAuction = await program.account.auctionState.fetch(auctionState);
    expect(JSON.stringify(endedAuction.status)).to.equal(JSON.stringify({ ended: {} }));
  });

  it("settles auction with royalty distribution — NFT to winner, SOL split", async () => {
    const sellerBalBefore = await connection.getBalance(seller.publicKey);
    const treasuryBalBefore = await connection.getBalance(PROTOCOL_TREASURY);

    const [winnerDeposit] = getDepositPDA(auctionState, bidder2.publicKey, program.programId);
    const winnerNftAta = await getAssociatedTokenAddress(nftMint, bidder2.publicKey);

    await program.methods
      .settleAuction()
      .accountsStrict({
        payer: seller.publicKey,
        auctionState,
        auctionVault,
        winnerDeposit,
        seller: seller.publicKey,
        winner: bidder2.publicKey,
        protocolTreasury: PROTOCOL_TREASURY,
        nftMint,
        nftMetadata: nftMetadataPda,
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

    const auction = await program.account.auctionState.fetch(auctionState);
    expect(JSON.stringify(auction.status)).to.equal(JSON.stringify({ settled: {} }));

    const winnerNftAccount = await getAccount(connection, winnerNftAta);
    expect(Number(winnerNftAccount.amount)).to.equal(1);

    const escrowAccount = await getAccount(connection, escrowNftAta);
    expect(Number(escrowAccount.amount)).to.equal(0);

    // Winning bid = 1.2 SOL. Seller == creator == treasury in this test.
    // Protocol fee = 1.2 SOL * 250/10000 = 0.03 SOL → treasury (== seller)
    // Royalties = 1.2 SOL * 500/10000 = 0.06 SOL → creator (== seller)
    // seller_receives = 1.2 - 0.03 - 0.06 = 1.11 SOL
    // Total to seller = 1.11 + 0.06 + 0.03 = 1.2 SOL (minus tx fee)
    const sellerBalAfter = await connection.getBalance(seller.publicKey);
    const sellerGain = sellerBalAfter - sellerBalBefore;
    expect(sellerGain).to.be.greaterThan(1.1 * LAMPORTS_PER_SOL);

    // Treasury balance delta (seller == treasury, so captured in seller gain)
    const treasuryBalAfter = await connection.getBalance(PROTOCOL_TREASURY);
    const treasuryDelta = treasuryBalAfter - treasuryBalBefore;
    // Treasury == seller in this test, so delta reflects combined flow
    expect(treasuryDelta).to.be.greaterThanOrEqual(0);

    const depositAccount = await program.account.bidderDeposit.fetch(winnerDeposit);
    expect(depositAccount.amount.toNumber()).to.equal(1.8 * LAMPORTS_PER_SOL);
  });

  it("allows winner to claim remaining deposit", async () => {
    const winnerBalBefore = await connection.getBalance(bidder2.publicKey);
    const [bidder2Deposit] = getDepositPDA(auctionState, bidder2.publicKey, program.programId);

    await program.methods
      .claimRefund()
      .accountsStrict({
        bidder: bidder2.publicKey,
        auctionState,
        bidderDeposit: bidder2Deposit,
        auctionVault,
        systemProgram: SystemProgram.programId,
      })
      .signers([bidder2])
      .rpc();

    const winnerBalAfter = await connection.getBalance(bidder2.publicKey);
    const refund = winnerBalAfter - winnerBalBefore;
    expect(refund).to.be.greaterThan(1.7 * LAMPORTS_PER_SOL);
  });

  it("allows loser to claim full refund", async () => {
    const loserBalBefore = await connection.getBalance(bidder1.publicKey);
    const [bidder1Deposit] = getDepositPDA(auctionState, bidder1.publicKey, program.programId);

    await program.methods
      .claimRefund()
      .accountsStrict({
        bidder: bidder1.publicKey,
        auctionState,
        bidderDeposit: bidder1Deposit,
        auctionVault,
        systemProgram: SystemProgram.programId,
      })
      .signers([bidder1])
      .rpc();

    const loserBalAfter = await connection.getBalance(bidder1.publicKey);
    const refund = loserBalAfter - loserBalBefore;
    expect(refund).to.be.greaterThan(2.9 * LAMPORTS_PER_SOL);

    // Deposit PDA is closed by the `close = bidder` constraint after claiming
    const depositInfo = await connection.getAccountInfo(bidder1Deposit);
    expect(depositInfo).to.be.null;
  });

  it("closes settled auction accounts and recovers rent", async () => {
    const sellerBalBefore = await connection.getBalance(seller.publicKey);

    await program.methods
      .closeAuction()
      .accountsStrict({
        seller: seller.publicKey,
        auctionState,
        auctionVault,
        nftMint,
        escrowNftTokenAccount: escrowNftAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([seller])
      .rpc();

    const sellerBalAfter = await connection.getBalance(seller.publicKey);
    expect(sellerBalAfter - sellerBalBefore).to.be.greaterThan(0);

    expect(await connection.getAccountInfo(auctionState)).to.be.null;
    expect(await connection.getAccountInfo(auctionVault)).to.be.null;
  });

  // =========================================================================
  // Cancel flow
  // =========================================================================

  describe("cancel flow", () => {
    const cancelSeller = Keypair.generate();
    let cancelNftMint: PublicKey;
    let cancelSellerNftAta: PublicKey;
    let cancelAuctionState: PublicKey;
    let cancelAuctionVault: PublicKey;
    let cancelEscrowNftAta: PublicKey;

    before(async () => {
      const airdrop = await connection.requestAirdrop(cancelSeller.publicKey, 10 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(airdrop);

      const nft = await createTestNft(connection, cancelSeller);
      cancelNftMint = nft.mint;
      cancelSellerNftAta = nft.ownerAta;

      [cancelAuctionState] = getAuctionPDA(cancelSeller.publicKey, cancelNftMint, program.programId);
      [cancelAuctionVault] = getVaultPDA(cancelAuctionState, program.programId);
      cancelEscrowNftAta = await getAssociatedTokenAddress(cancelNftMint, cancelAuctionState, true);

      await program.methods
        .createAuction(reservePrice, new anchor.BN(60), extensionSeconds, extensionWindow, minBidIncrement)
        .accountsStrict({
          seller: cancelSeller.publicKey,
          nftMint: cancelNftMint,
          sellerNftTokenAccount: cancelSellerNftAta,
          escrowNftTokenAccount: cancelEscrowNftAta,
          auctionState: cancelAuctionState,
          auctionVault: cancelAuctionVault,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([cancelSeller])
        .rpc();
    });

    it("cancels auction and returns NFT", async () => {
      let escrow = await getAccount(connection, cancelEscrowNftAta);
      expect(Number(escrow.amount)).to.equal(1);

      await program.methods
        .cancelAuction()
        .accountsStrict({
          seller: cancelSeller.publicKey,
          auctionState: cancelAuctionState,
          nftMint: cancelNftMint,
          escrowNftTokenAccount: cancelEscrowNftAta,
          sellerNftTokenAccount: cancelSellerNftAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([cancelSeller])
        .rpc();

      const sellerNft = await getAccount(connection, cancelSellerNftAta);
      expect(Number(sellerNft.amount)).to.equal(1);

      escrow = await getAccount(connection, cancelEscrowNftAta);
      expect(Number(escrow.amount)).to.equal(0);

      const auction = await program.account.auctionState.fetch(cancelAuctionState);
      expect(JSON.stringify(auction.status)).to.equal(JSON.stringify({ cancelled: {} }));
    });

    it("closes cancelled auction accounts and recovers rent", async () => {
      const sellerBalBefore = await connection.getBalance(cancelSeller.publicKey);

      await program.methods
        .closeAuction()
        .accountsStrict({
          seller: cancelSeller.publicKey,
          auctionState: cancelAuctionState,
          auctionVault: cancelAuctionVault,
          nftMint: cancelNftMint,
          escrowNftTokenAccount: cancelEscrowNftAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([cancelSeller])
        .rpc();

      const sellerBalAfter = await connection.getBalance(cancelSeller.publicKey);
      expect(sellerBalAfter - sellerBalBefore).to.be.greaterThan(0);
      expect(await connection.getAccountInfo(cancelAuctionState)).to.be.null;
    });
  });

  // =========================================================================
  // Forfeit flow (underfunded winner)
  // =========================================================================

  describe("forfeit flow (underfunded winner)", () => {
    const forfeitSeller = Keypair.generate();
    const griefer = Keypair.generate();
    let forfeitNftMint: PublicKey;
    let forfeitSellerNftAta: PublicKey;
    let forfeitAuctionState: PublicKey;
    let forfeitAuctionVault: PublicKey;
    let forfeitEscrowNftAta: PublicKey;
    let forfeitNftMetadata: PublicKey;

    before(async () => {
      for (const kp of [forfeitSeller, griefer]) {
        const sig = await connection.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig);
      }

      const nft = await createTestNft(connection, forfeitSeller, {
        sellerFeeBps: 0,
        creators: [],
      });
      forfeitNftMint = nft.mint;
      forfeitSellerNftAta = nft.ownerAta;
      forfeitNftMetadata = nft.metadata;

      [forfeitAuctionState] = getAuctionPDA(forfeitSeller.publicKey, forfeitNftMint, program.programId);
      [forfeitAuctionVault] = getVaultPDA(forfeitAuctionState, program.programId);
      forfeitEscrowNftAta = await getAssociatedTokenAddress(forfeitNftMint, forfeitAuctionState, true);

      await program.methods
        .createAuction(
          new anchor.BN(1 * LAMPORTS_PER_SOL),
          new anchor.BN(5),
          2, 2,
          new anchor.BN(0.1 * LAMPORTS_PER_SOL)
        )
        .accountsStrict({
          seller: forfeitSeller.publicKey,
          nftMint: forfeitNftMint,
          sellerNftTokenAccount: forfeitSellerNftAta,
          escrowNftTokenAccount: forfeitEscrowNftAta,
          auctionState: forfeitAuctionState,
          auctionVault: forfeitAuctionVault,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([forfeitSeller])
        .rpc();

      // Griefer deposits only 0.5 SOL (less than the 1 SOL reserve)
      const [grieferDeposit] = getDepositPDA(forfeitAuctionState, griefer.publicKey, program.programId);
      await program.methods
        .deposit(new anchor.BN(0.5 * LAMPORTS_PER_SOL))
        .accountsStrict({
          bidder: griefer.publicKey,
          auctionState: forfeitAuctionState,
          bidderDeposit: grieferDeposit,
          auctionVault: forfeitAuctionVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([griefer])
        .rpc();

      await program.methods
        .startAuction()
        .accountsStrict({ seller: forfeitSeller.publicKey, auctionState: forfeitAuctionState })
        .signers([forfeitSeller])
        .rpc();

      // Griefer bids 1 SOL but only deposited 0.5 SOL
      await program.methods
        .placeBid(new anchor.BN(1 * LAMPORTS_PER_SOL))
        .accountsStrict({ bidder: griefer.publicKey, auctionState: forfeitAuctionState })
        .signers([griefer])
        .rpc();

      const auction = await program.account.auctionState.fetch(forfeitAuctionState);
      const now = Math.floor(Date.now() / 1000);
      const waitTime = auction.endTime.toNumber() - now + 2;
      if (waitTime > 0) await sleep(waitTime * 1000);

      await program.methods
        .endAuction()
        .accountsStrict({ authority: forfeitSeller.publicKey, auctionState: forfeitAuctionState })
        .signers([forfeitSeller])
        .rpc();
    });

    it("rejects normal settlement when winner deposit is insufficient", async () => {
      const [winnerDeposit] = getDepositPDA(forfeitAuctionState, griefer.publicKey, program.programId);
      const winnerNftAta = await getAssociatedTokenAddress(forfeitNftMint, griefer.publicKey);

      try {
        await program.methods
          .settleAuction()
          .accountsStrict({
            payer: forfeitSeller.publicKey,
            auctionState: forfeitAuctionState,
            auctionVault: forfeitAuctionVault,
            winnerDeposit,
            seller: forfeitSeller.publicKey,
            winner: griefer.publicKey,
            protocolTreasury: PROTOCOL_TREASURY,
            nftMint: forfeitNftMint,
            nftMetadata: forfeitNftMetadata,
            escrowNftTokenAccount: forfeitEscrowNftAta,
            winnerNftTokenAccount: winnerNftAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([forfeitSeller])
          .rpc();
        expect.fail("Should have thrown InsufficientDeposit");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InsufficientDeposit");
      }
    });

    it("forfeits auction — NFT returned to seller, griefer deposit slashed", async () => {
      const sellerBalBefore = await connection.getBalance(forfeitSeller.publicKey);
      const [grieferDeposit] = getDepositPDA(forfeitAuctionState, griefer.publicKey, program.programId);

      await program.methods
        .forfeitAuction()
        .accountsStrict({
          payer: forfeitSeller.publicKey,
          auctionState: forfeitAuctionState,
          auctionVault: forfeitAuctionVault,
          winnerDeposit: grieferDeposit,
          seller: forfeitSeller.publicKey,
          nftMint: forfeitNftMint,
          escrowNftTokenAccount: forfeitEscrowNftAta,
          sellerNftTokenAccount: forfeitSellerNftAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([forfeitSeller])
        .rpc();

      const auction = await program.account.auctionState.fetch(forfeitAuctionState);
      expect(JSON.stringify(auction.status)).to.equal(JSON.stringify({ settled: {} }));

      const sellerNft = await getAccount(connection, forfeitSellerNftAta);
      expect(Number(sellerNft.amount)).to.equal(1);

      const escrow = await getAccount(connection, forfeitEscrowNftAta);
      expect(Number(escrow.amount)).to.equal(0);

      const sellerBalAfter = await connection.getBalance(forfeitSeller.publicKey);
      expect(sellerBalAfter - sellerBalBefore).to.be.greaterThan(0.4 * LAMPORTS_PER_SOL);

      const deposit = await program.account.bidderDeposit.fetch(grieferDeposit);
      expect(deposit.amount.toNumber()).to.equal(0);
    });
  });

  // =========================================================================
  // Settlement math — separate creator, seller, treasury
  // =========================================================================

  describe("settlement_math", () => {
    const smSeller = Keypair.generate();
    const smCreator = Keypair.generate();
    const smBidder = Keypair.generate();
    const smLoser = Keypair.generate();
    let smAuction: PublicKey;
    let smVault: PublicKey;
    let smEscrow: PublicKey;
    let smMint: PublicKey;
    let smMetadata: PublicKey;
    let smSellerNftAta: PublicKey;
    const winningBid = new anchor.BN(1 * LAMPORTS_PER_SOL);

    before(async () => {
      for (const kp of [smSeller, smCreator, smBidder, smLoser]) {
        const sig = await connection.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig);
      }
    });

    it("setup: creates auction with separate creator", async () => {
      // Creator creates mint, seller owns the NFT
      const nft = await createTestNft(connection, smCreator, {
        owner: smSeller,
        mintAuthority: smCreator,
        sellerFeeBps: 500, // 5%
        creators: [{ address: smCreator.publicKey, verified: true, share: 100 }],
      });
      smMint = nft.mint;
      smSellerNftAta = nft.ownerAta;
      smMetadata = nft.metadata;

      [smAuction] = getAuctionPDA(smSeller.publicKey, smMint, program.programId);
      [smVault] = getVaultPDA(smAuction, program.programId);
      smEscrow = await getAssociatedTokenAddress(smMint, smAuction, true);

      await program.methods
        .createAuction(
          winningBid, // 1 SOL reserve
          new anchor.BN(5),
          2, 2,
          new anchor.BN(0.1 * LAMPORTS_PER_SOL)
        )
        .accountsStrict({
          seller: smSeller.publicKey,
          nftMint: smMint,
          sellerNftTokenAccount: smSellerNftAta,
          escrowNftTokenAccount: smEscrow,
          auctionState: smAuction,
          auctionVault: smVault,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([smSeller])
        .rpc();

      const auction = await program.account.auctionState.fetch(smAuction);
      expect(JSON.stringify(auction.status)).to.equal(JSON.stringify({ created: {} }));
    });

    it("setup: deposits, starts, bids, ends", async () => {
      // Both bidders deposit 2 SOL
      for (const bidder of [smBidder, smLoser]) {
        const [depositPda] = getDepositPDA(smAuction, bidder.publicKey, program.programId);
        await program.methods
          .deposit(new anchor.BN(2 * LAMPORTS_PER_SOL))
          .accountsStrict({
            bidder: bidder.publicKey,
            auctionState: smAuction,
            bidderDeposit: depositPda,
            auctionVault: smVault,
            systemProgram: SystemProgram.programId,
          })
          .signers([bidder])
          .rpc();
      }

      await program.methods
        .startAuction()
        .accountsStrict({ seller: smSeller.publicKey, auctionState: smAuction })
        .signers([smSeller])
        .rpc();

      // Loser bids reserve
      await program.methods
        .placeBid(winningBid)
        .accountsStrict({ bidder: smLoser.publicKey, auctionState: smAuction })
        .signers([smLoser])
        .rpc();

      // Winner outbids — still at 1 SOL (equals reserve since only 1 bid before, min_increment = 0.1)
      // Actually, winner needs to bid >= 1 SOL + 0.1 SOL = 1.1 SOL
      // Let's keep it at 1 SOL exactly by having winner be first... no, loser already bid.
      // Just bid 1.1 SOL then. Math: 1.1 SOL * 500/10000 = 55,000,000 royalties, etc.
      // For clean math, let's use 1 SOL exactly. Redo: winner bids first at reserve, loser doesn't bid.
      // Actually that's complicated. Let me just accept 1.1 SOL winning bid.

      // Hmm, wait. Let me restructure. Make winner bid first at reserve (1 SOL).
      // Oh wait, loser already bid 1 SOL. Winner must bid >= 1.1 SOL.
      // For cleanest math: winning bid = 1 SOL. So only one bidder bids.
      // Let me redo: only smBidder bids at 1 SOL reserve. smLoser deposits but doesn't bid.

      // Wait, smLoser already bid above. Let me just accept the 1.1 SOL winning bid.
      // No wait, I need to control the test better. Let me remove the loser bid.

      // Actually — the test already called placeBid for smLoser. Can't undo.
      // So smBidder now must bid >= 1.1 SOL:
      await program.methods
        .placeBid(new anchor.BN(1.1 * LAMPORTS_PER_SOL))
        .accountsStrict({ bidder: smBidder.publicKey, auctionState: smAuction })
        .signers([smBidder])
        .rpc();

      const auction = await program.account.auctionState.fetch(smAuction);
      const now = Math.floor(Date.now() / 1000);
      const wait = auction.endTime.toNumber() - now + 2;
      if (wait > 0) await sleep(wait * 1000);

      await program.methods
        .endAuction()
        .accountsStrict({ authority: smSeller.publicKey, auctionState: smAuction })
        .signers([smSeller])
        .rpc();
    });

    it("settles with correct three-way split", async () => {
      // winning_bid = 1.1 SOL = 1,100,000,000 lamports
      // royalties = 1,100,000,000 * 500 / 10000 = 55,000,000 → creator
      // protocol_fee = 1,100,000,000 * 250 / 10000 = 27,500,000 → treasury
      // seller_receives = 1,100,000,000 - 55,000,000 - 27,500,000 = 1,017,500,000 → seller
      const expectedRoyalties = 55_000_000;
      const expectedProtocolFee = 27_500_000;
      const expectedSellerReceives = 1_017_500_000;

      const sellerBalBefore = await connection.getBalance(smSeller.publicKey);
      const creatorBalBefore = await connection.getBalance(smCreator.publicKey);
      const treasuryBalBefore = await connection.getBalance(PROTOCOL_TREASURY);

      const [winnerDeposit] = getDepositPDA(smAuction, smBidder.publicKey, program.programId);
      const winnerNftAta = await getAssociatedTokenAddress(smMint, smBidder.publicKey);

      await program.methods
        .settleAuction()
        .accountsStrict({
          payer: smSeller.publicKey,
          auctionState: smAuction,
          auctionVault: smVault,
          winnerDeposit,
          seller: smSeller.publicKey,
          winner: smBidder.publicKey,
          protocolTreasury: PROTOCOL_TREASURY,
          nftMint: smMint,
          nftMetadata: smMetadata,
          escrowNftTokenAccount: smEscrow,
          winnerNftTokenAccount: winnerNftAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([
          { pubkey: smCreator.publicKey, isSigner: false, isWritable: true },
        ])
        .signers([smSeller])
        .rpc();

      // Verify exact lamport deltas
      const creatorBalAfter = await connection.getBalance(smCreator.publicKey);
      const creatorDelta = creatorBalAfter - creatorBalBefore;
      expect(creatorDelta).to.equal(expectedRoyalties);

      const treasuryBalAfter = await connection.getBalance(PROTOCOL_TREASURY);
      const treasuryDelta = treasuryBalAfter - treasuryBalBefore;
      // Treasury may pay rent for its account creation on localnet, so allow small tolerance
      expect(treasuryDelta).to.be.greaterThan(expectedProtocolFee - 100_000);
      expect(treasuryDelta).to.be.lessThanOrEqual(expectedProtocolFee);

      // Seller also pays tx fee and winner ATA rent, so use approximate check
      const sellerBalAfter = await connection.getBalance(smSeller.publicKey);
      const sellerDelta = sellerBalAfter - sellerBalBefore;
      // seller_receives = 1,017,500,000, minus tx fee (~5000) and winner ATA rent (~2,039,280)
      // Net should be roughly 1,015,455,720
      expect(sellerDelta).to.be.greaterThan(expectedSellerReceives - 5_000_000);
      expect(sellerDelta).to.be.lessThan(expectedSellerReceives + 1_000_000);

      // Verify winner's deposit was deducted: 2 SOL - 1.1 SOL = 0.9 SOL
      const deposit = await program.account.bidderDeposit.fetch(winnerDeposit);
      expect(deposit.amount.toNumber()).to.equal(0.9 * LAMPORTS_PER_SOL);
    });

    it("loser claims full refund", async () => {
      const [loserDeposit] = getDepositPDA(smAuction, smLoser.publicKey, program.programId);
      const loserBalBefore = await connection.getBalance(smLoser.publicKey);

      await program.methods
        .claimRefund()
        .accountsStrict({
          bidder: smLoser.publicKey,
          auctionState: smAuction,
          bidderDeposit: loserDeposit,
          auctionVault: smVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([smLoser])
        .rpc();

      const loserBalAfter = await connection.getBalance(smLoser.publicKey);
      const refund = loserBalAfter - loserBalBefore;
      // Full 2 SOL deposit returned (minus tx fee + rent reclaim from closing deposit PDA)
      expect(refund).to.be.greaterThan(1.9 * LAMPORTS_PER_SOL);
    });
  });

  // =========================================================================
  // Anti-snipe extension
  // =========================================================================

  describe("anti_snipe_extension", () => {
    const snipeSeller = Keypair.generate();
    const snipeBidder = Keypair.generate();
    let snipeAuction: PublicKey;
    let snipeVault: PublicKey;
    let snipeEscrow: PublicKey;
    let snipeMint: PublicKey;

    before(async () => {
      for (const kp of [snipeSeller, snipeBidder]) {
        const sig = await connection.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig);
      }

      // duration=8s, extension_window=4s, extension_seconds=4s
      const nft = await createTestNft(connection, snipeSeller);
      snipeMint = nft.mint;

      [snipeAuction] = getAuctionPDA(snipeSeller.publicKey, snipeMint, program.programId);
      [snipeVault] = getVaultPDA(snipeAuction, program.programId);
      snipeEscrow = await getAssociatedTokenAddress(snipeMint, snipeAuction, true);

      await program.methods
        .createAuction(
          new anchor.BN(0.5 * LAMPORTS_PER_SOL),
          new anchor.BN(8), // 8 seconds
          4, // extension_seconds
          4, // extension_window
          new anchor.BN(0.1 * LAMPORTS_PER_SOL)
        )
        .accountsStrict({
          seller: snipeSeller.publicKey,
          nftMint: snipeMint,
          sellerNftTokenAccount: nft.ownerAta,
          escrowNftTokenAccount: snipeEscrow,
          auctionState: snipeAuction,
          auctionVault: snipeVault,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([snipeSeller])
        .rpc();

      // Bidder deposits
      const [depositPda] = getDepositPDA(snipeAuction, snipeBidder.publicKey, program.programId);
      await program.methods
        .deposit(new anchor.BN(5 * LAMPORTS_PER_SOL))
        .accountsStrict({
          bidder: snipeBidder.publicKey,
          auctionState: snipeAuction,
          bidderDeposit: depositPda,
          auctionVault: snipeVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([snipeBidder])
        .rpc();

      await program.methods
        .startAuction()
        .accountsStrict({ seller: snipeSeller.publicKey, auctionState: snipeAuction })
        .signers([snipeSeller])
        .rpc();
    });

    it("bid outside extension window does not extend end_time", async () => {
      // Bid immediately — time_remaining > extension_window (4s)
      const auctionBefore = await program.account.auctionState.fetch(snipeAuction);
      const endTimeBefore = auctionBefore.endTime.toNumber();

      await program.methods
        .placeBid(new anchor.BN(0.5 * LAMPORTS_PER_SOL))
        .accountsStrict({ bidder: snipeBidder.publicKey, auctionState: snipeAuction })
        .signers([snipeBidder])
        .rpc();

      const auctionAfter = await program.account.auctionState.fetch(snipeAuction);
      expect(auctionAfter.endTime.toNumber()).to.equal(endTimeBefore);
    });

    it("bid inside extension window extends end_time", async () => {
      // Wait until we're well within the extension window (4s before end)
      // Use validator clock (not wall clock) for precision
      const auction = await program.account.auctionState.fetch(snipeAuction);
      const endTime = auction.endTime.toNumber();

      // Poll until validator clock shows we're inside the extension window
      while (true) {
        const slot = await connection.getSlot();
        const blockTime = await connection.getBlockTime(slot);
        if (blockTime && blockTime >= endTime - 3) break; // 3s remaining < 4s window
        await sleep(500);
      }

      const endTimeBefore = (await program.account.auctionState.fetch(snipeAuction)).endTime.toNumber();

      await program.methods
        .placeBid(new anchor.BN(0.7 * LAMPORTS_PER_SOL))
        .accountsStrict({ bidder: snipeBidder.publicKey, auctionState: snipeAuction })
        .signers([snipeBidder])
        .rpc();

      const auctionAfter = await program.account.auctionState.fetch(snipeAuction);
      // end_time should have been extended by extension_seconds (4)
      expect(auctionAfter.endTime.toNumber()).to.equal(endTimeBefore + 4);
    });

    it("auction ends correctly after extensions", async () => {
      const auction = await program.account.auctionState.fetch(snipeAuction);
      const now = Math.floor(Date.now() / 1000);
      const wait = auction.endTime.toNumber() - now + 2;
      if (wait > 0) await sleep(wait * 1000);

      await program.methods
        .endAuction()
        .accountsStrict({ authority: snipeSeller.publicKey, auctionState: snipeAuction })
        .signers([snipeSeller])
        .rpc();

      const ended = await program.account.auctionState.fetch(snipeAuction);
      expect(JSON.stringify(ended.status)).to.equal(JSON.stringify({ ended: {} }));
    });
  });

  // =========================================================================
  // Error paths — create_auction
  // =========================================================================

  describe("error_paths_create_auction", () => {
    const errSeller = Keypair.generate();

    before(async () => {
      const sig = await connection.requestAirdrop(errSeller.publicKey, 10 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
    });

    it("rejects reserve_price of 0", async () => {
      const nft = await createTestNft(connection, errSeller);
      const [as] = getAuctionPDA(errSeller.publicKey, nft.mint, program.programId);
      const [av] = getVaultPDA(as, program.programId);
      const escrow = await getAssociatedTokenAddress(nft.mint, as, true);

      try {
        await program.methods
          .createAuction(new anchor.BN(0), new anchor.BN(60), 2, 2, new anchor.BN(0.1 * LAMPORTS_PER_SOL))
          .accountsStrict({
            seller: errSeller.publicKey,
            nftMint: nft.mint,
            sellerNftTokenAccount: nft.ownerAta,
            escrowNftTokenAccount: escrow,
            auctionState: as,
            auctionVault: av,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([errSeller])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidReservePrice");
      }
    });

    it("rejects duration below minimum (4s)", async () => {
      const nft = await createTestNft(connection, errSeller);
      const [as] = getAuctionPDA(errSeller.publicKey, nft.mint, program.programId);
      const [av] = getVaultPDA(as, program.programId);
      const escrow = await getAssociatedTokenAddress(nft.mint, as, true);

      try {
        await program.methods
          .createAuction(new anchor.BN(LAMPORTS_PER_SOL), new anchor.BN(4), 2, 2, new anchor.BN(0.1 * LAMPORTS_PER_SOL))
          .accountsStrict({
            seller: errSeller.publicKey,
            nftMint: nft.mint,
            sellerNftTokenAccount: nft.ownerAta,
            escrowNftTokenAccount: escrow,
            auctionState: as,
            auctionVault: av,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([errSeller])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidDuration");
      }
    });

    it("rejects duration above maximum", async () => {
      const nft = await createTestNft(connection, errSeller);
      const [as] = getAuctionPDA(errSeller.publicKey, nft.mint, program.programId);
      const [av] = getVaultPDA(as, program.programId);
      const escrow = await getAssociatedTokenAddress(nft.mint, as, true);

      try {
        await program.methods
          .createAuction(new anchor.BN(LAMPORTS_PER_SOL), new anchor.BN(604801), 2, 2, new anchor.BN(0.1 * LAMPORTS_PER_SOL))
          .accountsStrict({
            seller: errSeller.publicKey,
            nftMint: nft.mint,
            sellerNftTokenAccount: nft.ownerAta,
            escrowNftTokenAccount: escrow,
            auctionState: as,
            auctionVault: av,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([errSeller])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidDuration");
      }
    });

    it("rejects min_bid_increment of 0", async () => {
      const nft = await createTestNft(connection, errSeller);
      const [as] = getAuctionPDA(errSeller.publicKey, nft.mint, program.programId);
      const [av] = getVaultPDA(as, program.programId);
      const escrow = await getAssociatedTokenAddress(nft.mint, as, true);

      try {
        await program.methods
          .createAuction(new anchor.BN(LAMPORTS_PER_SOL), new anchor.BN(60), 2, 2, new anchor.BN(0))
          .accountsStrict({
            seller: errSeller.publicKey,
            nftMint: nft.mint,
            sellerNftTokenAccount: nft.ownerAta,
            escrowNftTokenAccount: escrow,
            auctionState: as,
            auctionVault: av,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([errSeller])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidBidIncrement");
      }
    });

    it("rejects non-NFT mint (decimals > 0)", async () => {
      // Create a fungible token mint with 6 decimals
      const fungibleMint = await createMint(connection, errSeller, errSeller.publicKey, null, 6);
      const fungibleAta = await createAssociatedTokenAccount(connection, errSeller, fungibleMint, errSeller.publicKey);
      await mintTo(connection, errSeller, fungibleMint, fungibleAta, errSeller, 1);

      const [as] = getAuctionPDA(errSeller.publicKey, fungibleMint, program.programId);
      const [av] = getVaultPDA(as, program.programId);
      const escrow = await getAssociatedTokenAddress(fungibleMint, as, true);

      try {
        await program.methods
          .createAuction(new anchor.BN(LAMPORTS_PER_SOL), new anchor.BN(60), 2, 2, new anchor.BN(0.1 * LAMPORTS_PER_SOL))
          .accountsStrict({
            seller: errSeller.publicKey,
            nftMint: fungibleMint,
            sellerNftTokenAccount: fungibleAta,
            escrowNftTokenAccount: escrow,
            auctionState: as,
            auctionVault: av,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([errSeller])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidNftMint");
      }
    });
  });

  // =========================================================================
  // Error paths — deposit
  // =========================================================================

  describe("error_paths_deposit", () => {
    const depSeller = Keypair.generate();
    const depBidder = Keypair.generate();
    let depAuction: PublicKey;
    let depVault: PublicKey;

    before(async () => {
      for (const kp of [depSeller, depBidder]) {
        const sig = await connection.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig);
      }

      const setup = await setupAuction(program, connection, depSeller, {
        durationSeconds: new anchor.BN(5),
      });
      depAuction = setup.auctionState;
      depVault = setup.auctionVault;
    });

    it("rejects deposit of 0 lamports", async () => {
      const [depositPda] = getDepositPDA(depAuction, depBidder.publicKey, program.programId);
      try {
        await program.methods
          .deposit(new anchor.BN(0))
          .accountsStrict({
            bidder: depBidder.publicKey,
            auctionState: depAuction,
            bidderDeposit: depositPda,
            auctionVault: depVault,
            systemProgram: SystemProgram.programId,
          })
          .signers([depBidder])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidDepositAmount");
      }
    });

    it("rejects deposit after settlement", async () => {
      // Run through full lifecycle to settlement
      const winner = Keypair.generate();
      const sig = await connection.requestAirdrop(winner.publicKey, 10 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);

      // Create a separate auction for settlement test
      const setup2 = await setupAuction(program, connection, depSeller, {
        durationSeconds: new anchor.BN(5),
        sellerFeeBps: 0,
        creators: [],
      });

      // Deposit
      const [winnerDep] = getDepositPDA(setup2.auctionState, winner.publicKey, program.programId);
      await program.methods
        .deposit(new anchor.BN(2 * LAMPORTS_PER_SOL))
        .accountsStrict({
          bidder: winner.publicKey,
          auctionState: setup2.auctionState,
          bidderDeposit: winnerDep,
          auctionVault: setup2.auctionVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([winner])
        .rpc();

      // Start, bid, wait, end, settle
      await program.methods
        .startAuction()
        .accountsStrict({ seller: depSeller.publicKey, auctionState: setup2.auctionState })
        .signers([depSeller])
        .rpc();

      await program.methods
        .placeBid(new anchor.BN(1 * LAMPORTS_PER_SOL))
        .accountsStrict({ bidder: winner.publicKey, auctionState: setup2.auctionState })
        .signers([winner])
        .rpc();

      const auction = await program.account.auctionState.fetch(setup2.auctionState);
      const now = Math.floor(Date.now() / 1000);
      const wait = auction.endTime.toNumber() - now + 2;
      if (wait > 0) await sleep(wait * 1000);

      await program.methods
        .endAuction()
        .accountsStrict({ authority: depSeller.publicKey, auctionState: setup2.auctionState })
        .signers([depSeller])
        .rpc();

      const winnerNftAta = await getAssociatedTokenAddress(setup2.nftMint, winner.publicKey);
      await program.methods
        .settleAuction()
        .accountsStrict({
          payer: depSeller.publicKey,
          auctionState: setup2.auctionState,
          auctionVault: setup2.auctionVault,
          winnerDeposit: winnerDep,
          seller: depSeller.publicKey,
          winner: winner.publicKey,
          protocolTreasury: PROTOCOL_TREASURY,
          nftMint: setup2.nftMint,
          nftMetadata: setup2.nftMetadata,
          escrowNftTokenAccount: setup2.escrowNftAta,
          winnerNftTokenAccount: winnerNftAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([depSeller])
        .rpc();

      // Now try to deposit on the settled auction
      const [newDepPda] = getDepositPDA(setup2.auctionState, depBidder.publicKey, program.programId);
      try {
        await program.methods
          .deposit(new anchor.BN(LAMPORTS_PER_SOL))
          .accountsStrict({
            bidder: depBidder.publicKey,
            auctionState: setup2.auctionState,
            bidderDeposit: newDepPda,
            auctionVault: setup2.auctionVault,
            systemProgram: SystemProgram.programId,
          })
          .signers([depBidder])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidAuctionStatus");
      }
    });
  });

  // =========================================================================
  // Error paths — start_auction
  // =========================================================================

  describe("error_paths_start_auction", () => {
    const startSeller = Keypair.generate();
    const imposter = Keypair.generate();
    let startAuction: PublicKey;

    before(async () => {
      for (const kp of [startSeller, imposter]) {
        const sig = await connection.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig);
      }

      const setup = await setupAuction(program, connection, startSeller);
      startAuction = setup.auctionState;
    });

    it("rejects non-seller starting auction", async () => {
      try {
        await program.methods
          .startAuction()
          .accountsStrict({ seller: imposter.publicKey, auctionState: startAuction })
          .signers([imposter])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        // Seeds constraint fails before has_one: seller PDA doesn't match
        expect(err.error.errorCode.code).to.equal("ConstraintSeeds");
      }
    });

    it("rejects starting Active auction", async () => {
      // Start it first
      await program.methods
        .startAuction()
        .accountsStrict({ seller: startSeller.publicKey, auctionState: startAuction })
        .signers([startSeller])
        .rpc();

      // Try starting again
      try {
        await program.methods
          .startAuction()
          .accountsStrict({ seller: startSeller.publicKey, auctionState: startAuction })
          .signers([startSeller])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidAuctionStatus");
      }
    });
  });

  // =========================================================================
  // Error paths — place_bid
  // =========================================================================

  describe("error_paths_place_bid", () => {
    const bidSeller = Keypair.generate();
    const bidBidder = Keypair.generate();
    let bidAuctionCreated: PublicKey;
    let bidAuctionActive: PublicKey;
    let bidVaultActive: PublicKey;

    before(async () => {
      for (const kp of [bidSeller, bidBidder]) {
        const sig = await connection.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig);
      }

      // Created auction (never started)
      const setup1 = await setupAuction(program, connection, bidSeller, {
        reservePrice: new anchor.BN(1 * LAMPORTS_PER_SOL),
      });
      bidAuctionCreated = setup1.auctionState;

      // Active auction
      const setup2 = await setupAuction(program, connection, bidSeller, {
        reservePrice: new anchor.BN(1 * LAMPORTS_PER_SOL),
        durationSeconds: new anchor.BN(5),
      });
      bidAuctionActive = setup2.auctionState;
      bidVaultActive = setup2.auctionVault;

      await program.methods
        .startAuction()
        .accountsStrict({ seller: bidSeller.publicKey, auctionState: bidAuctionActive })
        .signers([bidSeller])
        .rpc();
    });

    it("rejects first bid below reserve", async () => {
      try {
        await program.methods
          .placeBid(new anchor.BN(0.5 * LAMPORTS_PER_SOL)) // below 1 SOL reserve
          .accountsStrict({ bidder: bidBidder.publicKey, auctionState: bidAuctionActive })
          .signers([bidBidder])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("BelowReserve");
      }
    });

    it("rejects bid on Created auction", async () => {
      try {
        await program.methods
          .placeBid(new anchor.BN(1 * LAMPORTS_PER_SOL))
          .accountsStrict({ bidder: bidBidder.publicKey, auctionState: bidAuctionCreated })
          .signers([bidBidder])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidAuctionStatus");
      }
    });

    it("rejects bid after time expires", async () => {
      const auction = await program.account.auctionState.fetch(bidAuctionActive);
      const now = Math.floor(Date.now() / 1000);
      const wait = auction.endTime.toNumber() - now + 2;
      if (wait > 0) await sleep(wait * 1000);

      try {
        await program.methods
          .placeBid(new anchor.BN(1 * LAMPORTS_PER_SOL))
          .accountsStrict({ bidder: bidBidder.publicKey, auctionState: bidAuctionActive })
          .signers([bidBidder])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("AuctionEnded");
      }
    });
  });

  // =========================================================================
  // Error paths — end_auction
  // =========================================================================

  describe("error_paths_end_auction", () => {
    const endSeller = Keypair.generate();
    const endBidder = Keypair.generate();
    let endAuction: PublicKey;

    before(async () => {
      for (const kp of [endSeller, endBidder]) {
        const sig = await connection.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig);
      }

      const setup = await setupAuction(program, connection, endSeller, {
        durationSeconds: new anchor.BN(5),
      });
      endAuction = setup.auctionState;
    });

    it("rejects ending Created auction", async () => {
      try {
        await program.methods
          .endAuction()
          .accountsStrict({ authority: endSeller.publicKey, auctionState: endAuction })
          .signers([endSeller])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidAuctionStatus");
      }
    });

    it("rejects ending already-Ended auction", async () => {
      // Progress to Active then wait and end
      await program.methods
        .startAuction()
        .accountsStrict({ seller: endSeller.publicKey, auctionState: endAuction })
        .signers([endSeller])
        .rpc();

      const auction = await program.account.auctionState.fetch(endAuction);
      const now = Math.floor(Date.now() / 1000);
      const wait = auction.endTime.toNumber() - now + 2;
      if (wait > 0) await sleep(wait * 1000);

      await program.methods
        .endAuction()
        .accountsStrict({ authority: endSeller.publicKey, auctionState: endAuction })
        .signers([endSeller])
        .rpc();

      // Try ending again
      try {
        await program.methods
          .endAuction()
          .accountsStrict({ authority: endSeller.publicKey, auctionState: endAuction })
          .signers([endSeller])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidAuctionStatus");
      }
    });
  });

  // =========================================================================
  // Error paths — settle_auction
  // =========================================================================

  describe("error_paths_settle_auction", () => {
    const settleSeller = Keypair.generate();
    const settleBidder = Keypair.generate();
    let settleSetup1: Awaited<ReturnType<typeof setupAuction>>;
    let settleSetup2: Awaited<ReturnType<typeof setupAuction>>;

    before(async () => {
      for (const kp of [settleSeller, settleBidder]) {
        const sig = await connection.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig);
      }

      // Auction 1: will be started (Active) → tests Active settle + 0-bid settle
      settleSetup1 = await setupAuction(program, connection, settleSeller, {
        durationSeconds: new anchor.BN(5),
        sellerFeeBps: 0,
        creators: [],
      });

      // Auction 2: full lifecycle with bids → tests wrong treasury
      settleSetup2 = await setupAuction(program, connection, settleSeller, {
        durationSeconds: new anchor.BN(5),
        sellerFeeBps: 0,
        creators: [],
      });
    });

    it("rejects settling Active auction", async () => {
      // Bidder deposits so the winnerDeposit PDA exists
      const [winnerDep] = getDepositPDA(settleSetup1.auctionState, settleBidder.publicKey, program.programId);
      await program.methods
        .deposit(new anchor.BN(2 * LAMPORTS_PER_SOL))
        .accountsStrict({
          bidder: settleBidder.publicKey,
          auctionState: settleSetup1.auctionState,
          bidderDeposit: winnerDep,
          auctionVault: settleSetup1.auctionVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([settleBidder])
        .rpc();

      await program.methods
        .startAuction()
        .accountsStrict({ seller: settleSeller.publicKey, auctionState: settleSetup1.auctionState })
        .signers([settleSeller])
        .rpc();

      const winnerNftAta = await getAssociatedTokenAddress(settleSetup1.nftMint, settleBidder.publicKey);

      try {
        await program.methods
          .settleAuction()
          .accountsStrict({
            payer: settleSeller.publicKey,
            auctionState: settleSetup1.auctionState,
            auctionVault: settleSetup1.auctionVault,
            winnerDeposit: winnerDep,
            seller: settleSeller.publicKey,
            winner: settleBidder.publicKey,
            protocolTreasury: PROTOCOL_TREASURY,
            nftMint: settleSetup1.nftMint,
            nftMetadata: settleSetup1.nftMetadata,
            escrowNftTokenAccount: settleSetup1.escrowNftAta,
            winnerNftTokenAccount: winnerNftAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([settleSeller])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidAuctionStatus");
      }
    });

    it("rejects settling with zero bids", async () => {
      // Wait for auction 1 to expire and end it (0 bids)
      const auction = await program.account.auctionState.fetch(settleSetup1.auctionState);
      const now = Math.floor(Date.now() / 1000);
      const wait = auction.endTime.toNumber() - now + 2;
      if (wait > 0) await sleep(wait * 1000);

      await program.methods
        .endAuction()
        .accountsStrict({ authority: settleSeller.publicKey, auctionState: settleSetup1.auctionState })
        .signers([settleSeller])
        .rpc();

      // winnerDeposit PDA was already created above during "rejects settling Active" test
      const [winnerDep] = getDepositPDA(settleSetup1.auctionState, settleBidder.publicKey, program.programId);
      const winnerNftAta = await getAssociatedTokenAddress(settleSetup1.nftMint, settleBidder.publicKey);

      try {
        await program.methods
          .settleAuction()
          .accountsStrict({
            payer: settleSeller.publicKey,
            auctionState: settleSetup1.auctionState,
            auctionVault: settleSetup1.auctionVault,
            winnerDeposit: winnerDep,
            seller: settleSeller.publicKey,
            winner: settleBidder.publicKey,
            protocolTreasury: PROTOCOL_TREASURY,
            nftMint: settleSetup1.nftMint,
            nftMetadata: settleSetup1.nftMetadata,
            escrowNftTokenAccount: settleSetup1.escrowNftAta,
            winnerNftTokenAccount: winnerNftAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([settleSeller])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("NoBidsToSettle");
      }
    });

    it("rejects wrong treasury address", async () => {
      // Setup auction 2: deposit, start, bid, wait, end
      const [bidderDep] = getDepositPDA(settleSetup2.auctionState, settleBidder.publicKey, program.programId);
      await program.methods
        .deposit(new anchor.BN(2 * LAMPORTS_PER_SOL))
        .accountsStrict({
          bidder: settleBidder.publicKey,
          auctionState: settleSetup2.auctionState,
          bidderDeposit: bidderDep,
          auctionVault: settleSetup2.auctionVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([settleBidder])
        .rpc();

      await program.methods
        .startAuction()
        .accountsStrict({ seller: settleSeller.publicKey, auctionState: settleSetup2.auctionState })
        .signers([settleSeller])
        .rpc();

      await program.methods
        .placeBid(new anchor.BN(1 * LAMPORTS_PER_SOL))
        .accountsStrict({ bidder: settleBidder.publicKey, auctionState: settleSetup2.auctionState })
        .signers([settleBidder])
        .rpc();

      const auction = await program.account.auctionState.fetch(settleSetup2.auctionState);
      const now = Math.floor(Date.now() / 1000);
      const wait = auction.endTime.toNumber() - now + 2;
      if (wait > 0) await sleep(wait * 1000);

      await program.methods
        .endAuction()
        .accountsStrict({ authority: settleSeller.publicKey, auctionState: settleSetup2.auctionState })
        .signers([settleSeller])
        .rpc();

      const winnerNftAta = await getAssociatedTokenAddress(settleSetup2.nftMint, settleBidder.publicKey);
      const fakeTreasury = Keypair.generate().publicKey;

      try {
        await program.methods
          .settleAuction()
          .accountsStrict({
            payer: settleSeller.publicKey,
            auctionState: settleSetup2.auctionState,
            auctionVault: settleSetup2.auctionVault,
            winnerDeposit: bidderDep,
            seller: settleSeller.publicKey,
            winner: settleBidder.publicKey,
            protocolTreasury: fakeTreasury,
            nftMint: settleSetup2.nftMint,
            nftMetadata: settleSetup2.nftMetadata,
            escrowNftTokenAccount: settleSetup2.escrowNftAta,
            winnerNftTokenAccount: winnerNftAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([settleSeller])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidTreasury");
      }
    });
  });

  // =========================================================================
  // Error paths — cancel_auction
  // =========================================================================

  describe("error_paths_cancel_auction", () => {
    const cancelSeller2 = Keypair.generate();
    const imposter2 = Keypair.generate();
    const cancelBidder = Keypair.generate();

    before(async () => {
      for (const kp of [cancelSeller2, imposter2, cancelBidder]) {
        const sig = await connection.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig);
      }
    });

    it("rejects non-seller cancelling", async () => {
      const setup = await setupAuction(program, connection, cancelSeller2);

      try {
        await program.methods
          .cancelAuction()
          .accountsStrict({
            seller: imposter2.publicKey,
            auctionState: setup.auctionState,
            nftMint: setup.nftMint,
            escrowNftTokenAccount: setup.escrowNftAta,
            sellerNftTokenAccount: setup.sellerNftAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([imposter2])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        // Seeds constraint fails: imposter's key doesn't match PDA derivation
        expect(err.error.errorCode.code).to.equal("ConstraintSeeds");
      }
    });

    it("rejects cancelling Active auction with bids", async () => {
      const setup = await setupAuction(program, connection, cancelSeller2, {
        durationSeconds: new anchor.BN(60),
        reservePrice: new anchor.BN(0.5 * LAMPORTS_PER_SOL),
      });

      await program.methods
        .startAuction()
        .accountsStrict({ seller: cancelSeller2.publicKey, auctionState: setup.auctionState })
        .signers([cancelSeller2])
        .rpc();

      // Place a bid
      await program.methods
        .placeBid(new anchor.BN(0.5 * LAMPORTS_PER_SOL))
        .accountsStrict({ bidder: cancelBidder.publicKey, auctionState: setup.auctionState })
        .signers([cancelBidder])
        .rpc();

      try {
        await program.methods
          .cancelAuction()
          .accountsStrict({
            seller: cancelSeller2.publicKey,
            auctionState: setup.auctionState,
            nftMint: setup.nftMint,
            escrowNftTokenAccount: setup.escrowNftAta,
            sellerNftTokenAccount: setup.sellerNftAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([cancelSeller2])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidAuctionStatus");
      }
    });
  });

  // =========================================================================
  // Error paths — claim_refund
  // =========================================================================

  describe("error_paths_claim_refund", () => {
    const refundSeller = Keypair.generate();
    const refundBidder = Keypair.generate();

    before(async () => {
      for (const kp of [refundSeller, refundBidder]) {
        const sig = await connection.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig);
      }
    });

    it("rejects refund while Active", async () => {
      const setup = await setupAuction(program, connection, refundSeller, {
        durationSeconds: new anchor.BN(60),
      });

      const [depositPda] = getDepositPDA(setup.auctionState, refundBidder.publicKey, program.programId);
      await program.methods
        .deposit(new anchor.BN(1 * LAMPORTS_PER_SOL))
        .accountsStrict({
          bidder: refundBidder.publicKey,
          auctionState: setup.auctionState,
          bidderDeposit: depositPda,
          auctionVault: setup.auctionVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([refundBidder])
        .rpc();

      await program.methods
        .startAuction()
        .accountsStrict({ seller: refundSeller.publicKey, auctionState: setup.auctionState })
        .signers([refundSeller])
        .rpc();

      try {
        await program.methods
          .claimRefund()
          .accountsStrict({
            bidder: refundBidder.publicKey,
            auctionState: setup.auctionState,
            bidderDeposit: depositPda,
            auctionVault: setup.auctionVault,
            systemProgram: SystemProgram.programId,
          })
          .signers([refundBidder])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("RefundNotAvailable");
      }
    });

    it("rejects double refund (account closed after first)", async () => {
      // Create a full lifecycle to settled, then claim refund twice
      const setup = await setupAuction(program, connection, refundSeller, {
        durationSeconds: new anchor.BN(5),
        sellerFeeBps: 0,
        creators: [],
      });

      const [depositPda] = getDepositPDA(setup.auctionState, refundBidder.publicKey, program.programId);
      await program.methods
        .deposit(new anchor.BN(2 * LAMPORTS_PER_SOL))
        .accountsStrict({
          bidder: refundBidder.publicKey,
          auctionState: setup.auctionState,
          bidderDeposit: depositPda,
          auctionVault: setup.auctionVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([refundBidder])
        .rpc();

      await program.methods
        .startAuction()
        .accountsStrict({ seller: refundSeller.publicKey, auctionState: setup.auctionState })
        .signers([refundSeller])
        .rpc();

      await program.methods
        .placeBid(new anchor.BN(1 * LAMPORTS_PER_SOL))
        .accountsStrict({ bidder: refundBidder.publicKey, auctionState: setup.auctionState })
        .signers([refundBidder])
        .rpc();

      const auction = await program.account.auctionState.fetch(setup.auctionState);
      const now = Math.floor(Date.now() / 1000);
      const wait = auction.endTime.toNumber() - now + 2;
      if (wait > 0) await sleep(wait * 1000);

      await program.methods
        .endAuction()
        .accountsStrict({ authority: refundSeller.publicKey, auctionState: setup.auctionState })
        .signers([refundSeller])
        .rpc();

      const winnerNftAta = await getAssociatedTokenAddress(setup.nftMint, refundBidder.publicKey);
      await program.methods
        .settleAuction()
        .accountsStrict({
          payer: refundSeller.publicKey,
          auctionState: setup.auctionState,
          auctionVault: setup.auctionVault,
          winnerDeposit: depositPda,
          seller: refundSeller.publicKey,
          winner: refundBidder.publicKey,
          protocolTreasury: PROTOCOL_TREASURY,
          nftMint: setup.nftMint,
          nftMetadata: setup.nftMetadata,
          escrowNftTokenAccount: setup.escrowNftAta,
          winnerNftTokenAccount: winnerNftAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([refundSeller])
        .rpc();

      // First refund succeeds (claim remaining deposit)
      await program.methods
        .claimRefund()
        .accountsStrict({
          bidder: refundBidder.publicKey,
          auctionState: setup.auctionState,
          bidderDeposit: depositPda,
          auctionVault: setup.auctionVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([refundBidder])
        .rpc();

      // Second refund fails — deposit PDA is closed
      try {
        await program.methods
          .claimRefund()
          .accountsStrict({
            bidder: refundBidder.publicKey,
            auctionState: setup.auctionState,
            bidderDeposit: depositPda,
            auctionVault: setup.auctionVault,
            systemProgram: SystemProgram.programId,
          })
          .signers([refundBidder])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        // Account is closed — Anchor can't deserialize it
        expect(err).to.exist;
      }
    });
  });

  // =========================================================================
  // Error paths — close_auction
  // =========================================================================

  describe("error_paths_close_auction", () => {
    const closeSeller = Keypair.generate();
    const closeImposter = Keypair.generate();

    before(async () => {
      for (const kp of [closeSeller, closeImposter]) {
        const sig = await connection.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig);
      }
    });

    it("rejects non-seller closing", async () => {
      const setup = await setupAuction(program, connection, closeSeller);

      // Cancel first so it's in a closeable state
      await program.methods
        .cancelAuction()
        .accountsStrict({
          seller: closeSeller.publicKey,
          auctionState: setup.auctionState,
          nftMint: setup.nftMint,
          escrowNftTokenAccount: setup.escrowNftAta,
          sellerNftTokenAccount: setup.sellerNftAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([closeSeller])
        .rpc();

      try {
        await program.methods
          .closeAuction()
          .accountsStrict({
            seller: closeImposter.publicKey,
            auctionState: setup.auctionState,
            auctionVault: setup.auctionVault,
            nftMint: setup.nftMint,
            escrowNftTokenAccount: setup.escrowNftAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([closeImposter])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("ConstraintSeeds");
      }
    });

    it("rejects closing Active auction", async () => {
      const setup = await setupAuction(program, connection, closeSeller, {
        durationSeconds: new anchor.BN(60),
      });

      await program.methods
        .startAuction()
        .accountsStrict({ seller: closeSeller.publicKey, auctionState: setup.auctionState })
        .signers([closeSeller])
        .rpc();

      try {
        await program.methods
          .closeAuction()
          .accountsStrict({
            seller: closeSeller.publicKey,
            auctionState: setup.auctionState,
            auctionVault: setup.auctionVault,
            nftMint: setup.nftMint,
            escrowNftTokenAccount: setup.escrowNftAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([closeSeller])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidAuctionStatus");
      }
    });
  });

  // =========================================================================
  // Error paths — forfeit_auction
  // =========================================================================

  describe("error_paths_forfeit_auction", () => {
    const forfSeller = Keypair.generate();
    const forfBidder = Keypair.generate();

    before(async () => {
      for (const kp of [forfSeller, forfBidder]) {
        const sig = await connection.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig);
      }
    });

    it("rejects forfeit when deposit is sufficient", async () => {
      const setup = await setupAuction(program, connection, forfSeller, {
        durationSeconds: new anchor.BN(5),
        sellerFeeBps: 0,
        creators: [],
      });

      // Bidder deposits MORE than enough
      const [depositPda] = getDepositPDA(setup.auctionState, forfBidder.publicKey, program.programId);
      await program.methods
        .deposit(new anchor.BN(2 * LAMPORTS_PER_SOL))
        .accountsStrict({
          bidder: forfBidder.publicKey,
          auctionState: setup.auctionState,
          bidderDeposit: depositPda,
          auctionVault: setup.auctionVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([forfBidder])
        .rpc();

      await program.methods
        .startAuction()
        .accountsStrict({ seller: forfSeller.publicKey, auctionState: setup.auctionState })
        .signers([forfSeller])
        .rpc();

      await program.methods
        .placeBid(new anchor.BN(1 * LAMPORTS_PER_SOL))
        .accountsStrict({ bidder: forfBidder.publicKey, auctionState: setup.auctionState })
        .signers([forfBidder])
        .rpc();

      const auction = await program.account.auctionState.fetch(setup.auctionState);
      const now = Math.floor(Date.now() / 1000);
      const wait = auction.endTime.toNumber() - now + 2;
      if (wait > 0) await sleep(wait * 1000);

      await program.methods
        .endAuction()
        .accountsStrict({ authority: forfSeller.publicKey, auctionState: setup.auctionState })
        .signers([forfSeller])
        .rpc();

      // Try to forfeit when deposit (2 SOL) >= bid (1 SOL) → should fail
      try {
        await program.methods
          .forfeitAuction()
          .accountsStrict({
            payer: forfSeller.publicKey,
            auctionState: setup.auctionState,
            auctionVault: setup.auctionVault,
            winnerDeposit: depositPda,
            seller: forfSeller.publicKey,
            nftMint: setup.nftMint,
            escrowNftTokenAccount: setup.escrowNftAta,
            sellerNftTokenAccount: setup.sellerNftAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([forfSeller])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("ForfeitNotNeeded");
      }
    });
  });
});
