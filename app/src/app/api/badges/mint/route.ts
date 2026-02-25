import { NextRequest, NextResponse } from "next/server";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { keypairIdentity } from "@metaplex-foundation/umi";
import { fromWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";
import { mintBadge, type BadgeType } from "@/lib/badges";
import { PROGRAM_ID } from "@/lib/constants";

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

/**
 * Verify auction exists and is in Settled status by reading on-chain state.
 * AuctionState layout: discriminator(8) + seller(32) + nftMint(32) + ...
 * Status field is a Borsh enum at a fixed offset. We check the account owner
 * matches our program.
 */
async function verifyAuctionSettled(auctionId: string): Promise<boolean> {
  try {
    const connection = new Connection(HELIUS_RPC, "confirmed");
    const pubkey = new PublicKey(auctionId);
    const info = await connection.getAccountInfo(pubkey);
    if (!info || !info.owner.equals(PROGRAM_ID)) return false;
    // AuctionState status byte offset:
    //   8 (disc) + 32 (seller) + 32 (nftMint) + 8 (reservePrice) + 8 (durationSeconds)
    //   + 8 (currentBid) + 32 (highestBidder) + 8 (startTime) + 8 (endTime)
    //   + 4 (extensionSeconds) + 4 (extensionWindow) + 8 (minBidIncrement)
    //   = offset 160 for status enum
    const STATUS_OFFSET = 160;
    if (info.data.length <= STATUS_OFFSET) return false;
    // Borsh enum: Settled = 3
    return info.data[STATUS_OFFSET] === 3;
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
  const isSettled = await verifyAuctionSettled(auctionId);
  if (!isSettled) {
    return NextResponse.json(
      { error: "Auction is not in Settled status" },
      { status: 403 }
    );
  }

  // Mark as minted before processing to prevent concurrent duplicate calls
  mintedAuctions.add(auctionId);

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

  return NextResponse.json({ results });
}
