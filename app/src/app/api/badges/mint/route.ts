import { NextRequest, NextResponse } from "next/server";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { keypairIdentity } from "@metaplex-foundation/umi";
import { fromWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";
import { mintBadge, type BadgeType } from "@/lib/badges";
import { PROGRAM_ID } from "@/lib/constants";

const DEPOSIT_SEED = Buffer.from("deposit");

const HELIUS_RPC =
  process.env.NEXT_PUBLIC_HELIUS_RPC || "https://api.devnet.solana.com";
const BADGE_MERKLE_TREE = process.env.NEXT_PUBLIC_BADGE_MERKLE_TREE || "";
const TREE_AUTHORITY_KEY = process.env.BADGE_TREE_AUTHORITY_KEY || "";

// In-memory dedup: track which auctions have already had badges minted.
// Prevents repeated calls from minting duplicate badges.
const mintedAuctions = new Set<string>();

interface MintRecipient {
  address: string;
  badgeType: BadgeType;
  auctionName: string;
  auctionId: string;
  winningBid?: string;
}

interface AuctionVerification {
  settled: boolean;
  highestBidder: PublicKey | null;
}

/**
 * Verify auction exists and is in Settled status by reading on-chain state.
 * Returns the highest_bidder for victor verification.
 *
 * AuctionState layout:
 *   8 (disc) + 32 (seller) + 32 (nftMint) + 8 (reservePrice) + 8 (durationSeconds)
 *   + 8 (currentBid) + 32 (highestBidder) + 8 (startTime) + 8 (endTime)
 *   + 4 (extensionSeconds) + 4 (extensionWindow) + 8 (minBidIncrement)
 *   = offset 160 for status enum
 */
async function verifyAuctionSettled(auctionId: string): Promise<AuctionVerification> {
  try {
    const connection = new Connection(HELIUS_RPC, "confirmed");
    const pubkey = new PublicKey(auctionId);
    const info = await connection.getAccountInfo(pubkey);
    if (!info || !info.owner.equals(PROGRAM_ID))
      return { settled: false, highestBidder: null };

    const STATUS_OFFSET = 160;
    if (info.data.length <= STATUS_OFFSET)
      return { settled: false, highestBidder: null };

    // Borsh enum: Settled = 3
    const settled = info.data[STATUS_OFFSET] === 3;

    // highest_bidder starts at offset 96 (8+32+32+8+8+8), 32 bytes
    const BIDDER_OFFSET = 96;
    const highestBidder = new PublicKey(info.data.subarray(BIDDER_OFFSET, BIDDER_OFFSET + 32));

    return { settled, highestBidder };
  } catch {
    return { settled: false, highestBidder: null };
  }
}

/**
 * Check if a BidderDeposit PDA exists for a given auction+bidder pair.
 * Proves the recipient actually participated as a bidder.
 */
async function hasBidderDeposit(auctionId: string, bidder: string): Promise<boolean> {
  try {
    const connection = new Connection(HELIUS_RPC, "confirmed");
    const auctionPubkey = new PublicKey(auctionId);
    const bidderPubkey = new PublicKey(bidder);
    const [depositPda] = PublicKey.findProgramAddressSync(
      [DEPOSIT_SEED, auctionPubkey.toBuffer(), bidderPubkey.toBuffer()],
      PROGRAM_ID
    );
    const info = await connection.getAccountInfo(depositPda);
    // PDA exists and is owned by our program (may be closed after refund, but
    // that's OK — winner's deposit is consumed at settlement, losers can claim)
    return info !== null && info.owner.equals(PROGRAM_ID);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  if (!BADGE_MERKLE_TREE || !TREE_AUTHORITY_KEY) {
    return NextResponse.json(
      { error: "Badge minting not configured" },
      { status: 503 }
    );
  }

  let body: { recipients: MintRecipient[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.recipients) || body.recipients.length === 0) {
    return NextResponse.json(
      { error: "recipients array is required" },
      { status: 400 }
    );
  }

  // Cap at 20 recipients per request to avoid timeouts
  if (body.recipients.length > 20) {
    return NextResponse.json(
      { error: "Maximum 20 recipients per request" },
      { status: 400 }
    );
  }

  // Validate badgeType values
  const validBadgeTypes = new Set(["present", "contender", "victor"]);
  const invalidType = body.recipients.find((r) => !validBadgeTypes.has(r.badgeType));
  if (invalidType) {
    return NextResponse.json(
      { error: `Invalid badgeType: ${invalidType.badgeType}. Must be one of: present, contender, victor` },
      { status: 400 }
    );
  }

  // All recipients must share the same auctionId
  const auctionId = body.recipients[0].auctionId;
  if (!auctionId || body.recipients.some((r) => r.auctionId !== auctionId)) {
    return NextResponse.json(
      { error: "All recipients must share the same auctionId" },
      { status: 400 }
    );
  }

  // Dedup: skip if badges already minted for this auction
  if (mintedAuctions.has(auctionId)) {
    return NextResponse.json(
      { error: "Badges already minted for this auction" },
      { status: 409 }
    );
  }

  // Verify the auction is actually Settled on-chain
  const { settled, highestBidder } = await verifyAuctionSettled(auctionId);
  if (!settled) {
    return NextResponse.json(
      { error: "Auction is not in Settled status" },
      { status: 403 }
    );
  }

  // Verify recipient eligibility based on badge type
  for (const r of body.recipients) {
    try {
      new PublicKey(r.address);
    } catch {
      return NextResponse.json(
        { error: `Invalid Solana address: ${r.address}` },
        { status: 400 }
      );
    }

    if (r.badgeType === "victor") {
      // Victor must match on-chain highest_bidder
      if (!highestBidder || r.address !== highestBidder.toBase58()) {
        return NextResponse.json(
          { error: `Victor address ${r.address} does not match auction winner` },
          { status: 403 }
        );
      }
    } else if (r.badgeType === "contender") {
      // Contender must have a BidderDeposit PDA (proves they deposited)
      const deposited = await hasBidderDeposit(auctionId, r.address);
      if (!deposited) {
        return NextResponse.json(
          { error: `Contender ${r.address} has no deposit record for this auction` },
          { status: 403 }
        );
      }
    }
    // "present" — no on-chain proof of viewership, allow any valid pubkey
  }

  // Build server-side Umi with deployer keypair
  const keypairBytes = JSON.parse(TREE_AUTHORITY_KEY) as number[];
  const wallet = Keypair.fromSecretKey(Uint8Array.from(keypairBytes));
  const umi = createUmi(HELIUS_RPC);
  umi.use(keypairIdentity(fromWeb3JsKeypair(wallet)));

  const results: Array<{
    address: string;
    badgeType: string;
    success: boolean;
    error?: string;
  }> = [];

  // Mint sequentially — each is independent, failures don't block others
  for (const r of body.recipients) {
    try {
      await mintBadge(
        umi,
        BADGE_MERKLE_TREE,
        r.address,
        r.badgeType,
        r.auctionName,
        r.auctionId,
        r.winningBid
      );
      results.push({ address: r.address, badgeType: r.badgeType, success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Badge mint failed for ${r.address}:`, msg);
      results.push({
        address: r.address,
        badgeType: r.badgeType,
        success: false,
        error: msg,
      });
    }
  }

  // Only mark as minted if at least one badge succeeded (allows retry on total failure)
  if (results.some((r) => r.success)) {
    mintedAuctions.add(auctionId);
  }

  return NextResponse.json({ results });
}
