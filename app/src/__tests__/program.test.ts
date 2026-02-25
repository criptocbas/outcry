import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  getAuctionPDA,
  getVaultPDA,
  getDepositPDA,
  getMetadataPDA,
  parseMetadataCreators,
} from "@/lib/program";
import { PROGRAM_ID, TOKEN_METADATA_PROGRAM_ID } from "@/lib/constants";

// Deterministic test keys
const SELLER = new PublicKey("7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV");
const NFT_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const BIDDER = new PublicKey("11111111111111111111111111111111");

// ---------------------------------------------------------------------------
// PDA derivation
// ---------------------------------------------------------------------------
describe("getAuctionPDA", () => {
  it("derives deterministic PDA", () => {
    const [pda, bump] = getAuctionPDA(SELLER, NFT_MINT);
    expect(pda).toBeInstanceOf(PublicKey);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  it("is deterministic (same inputs → same output)", () => {
    const [pda1] = getAuctionPDA(SELLER, NFT_MINT);
    const [pda2] = getAuctionPDA(SELLER, NFT_MINT);
    expect(pda1.equals(pda2)).toBe(true);
  });

  it("different sellers produce different PDAs", () => {
    const [pda1] = getAuctionPDA(SELLER, NFT_MINT);
    const [pda2] = getAuctionPDA(BIDDER, NFT_MINT);
    expect(pda1.equals(pda2)).toBe(false);
  });

  it("PDA is off-curve (not a valid ed25519 point)", () => {
    const [pda] = getAuctionPDA(SELLER, NFT_MINT);
    // PDAs should not be on the ed25519 curve
    expect(PublicKey.isOnCurve(pda.toBytes())).toBe(false);
  });
});

describe("getVaultPDA", () => {
  it("derives from auction state pubkey", () => {
    const [auctionPDA] = getAuctionPDA(SELLER, NFT_MINT);
    const [vaultPDA, bump] = getVaultPDA(auctionPDA);
    expect(vaultPDA).toBeInstanceOf(PublicKey);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(PublicKey.isOnCurve(vaultPDA.toBytes())).toBe(false);
  });

  it("different auctions produce different vaults", () => {
    const [auction1] = getAuctionPDA(SELLER, NFT_MINT);
    const [auction2] = getAuctionPDA(BIDDER, NFT_MINT);
    const [vault1] = getVaultPDA(auction1);
    const [vault2] = getVaultPDA(auction2);
    expect(vault1.equals(vault2)).toBe(false);
  });
});

describe("getDepositPDA", () => {
  it("derives from auction + bidder", () => {
    const [auctionPDA] = getAuctionPDA(SELLER, NFT_MINT);
    const [depositPDA, bump] = getDepositPDA(auctionPDA, BIDDER);
    expect(depositPDA).toBeInstanceOf(PublicKey);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(PublicKey.isOnCurve(depositPDA.toBytes())).toBe(false);
  });

  it("different bidders produce different deposits", () => {
    const [auctionPDA] = getAuctionPDA(SELLER, NFT_MINT);
    const [dep1] = getDepositPDA(auctionPDA, SELLER);
    const [dep2] = getDepositPDA(auctionPDA, BIDDER);
    expect(dep1.equals(dep2)).toBe(false);
  });
});

describe("getMetadataPDA", () => {
  it("derives using Token Metadata program", () => {
    const [metaPDA] = getMetadataPDA(NFT_MINT);
    expect(metaPDA).toBeInstanceOf(PublicKey);
    expect(PublicKey.isOnCurve(metaPDA.toBytes())).toBe(false);
  });

  it("different mints produce different metadata PDAs", () => {
    const [meta1] = getMetadataPDA(NFT_MINT);
    const [meta2] = getMetadataPDA(SELLER);
    expect(meta1.equals(meta2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseMetadataCreators
// ---------------------------------------------------------------------------
describe("parseMetadataCreators", () => {
  /**
   * Build a minimal fake Metaplex metadata buffer:
   * key(1) + update_authority(32) + mint(32) = 65 bytes
   * Then 3 borsh strings (4-byte len + data each)
   * Then seller_fee_basis_points(2)
   * Then Option<Vec<Creator>>
   */
  function buildMetadataBuffer(opts: {
    name: string;
    symbol: string;
    uri: string;
    sellerFeeBps: number;
    creators?: Array<{ address: PublicKey; verified: boolean; share: number }>;
  }): Buffer {
    const parts: Buffer[] = [];
    // key (1 byte) — metadata account type = 4
    parts.push(Buffer.from([4]));
    // update_authority (32 bytes)
    parts.push(SELLER.toBuffer());
    // mint (32 bytes)
    parts.push(NFT_MINT.toBuffer());

    // 3 borsh strings
    for (const str of [opts.name, opts.symbol, opts.uri]) {
      const strBuf = Buffer.from(str, "utf-8");
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32LE(strBuf.length);
      parts.push(lenBuf, strBuf);
    }

    // seller_fee_basis_points (u16 LE)
    const bpsBuf = Buffer.alloc(2);
    bpsBuf.writeUInt16LE(opts.sellerFeeBps);
    parts.push(bpsBuf);

    // Option<Vec<Creator>>
    if (opts.creators && opts.creators.length > 0) {
      parts.push(Buffer.from([1])); // Some
      const countBuf = Buffer.alloc(4);
      countBuf.writeUInt32LE(opts.creators.length);
      parts.push(countBuf);
      for (const c of opts.creators) {
        parts.push(c.address.toBuffer());
        parts.push(Buffer.from([c.verified ? 1 : 0]));
        parts.push(Buffer.from([c.share]));
      }
    } else {
      parts.push(Buffer.from([0])); // None
    }

    return Buffer.concat(parts);
  }

  it("parses metadata with one creator", () => {
    const buf = buildMetadataBuffer({
      name: "Test NFT",
      symbol: "TEST",
      uri: "https://example.com/meta.json",
      sellerFeeBps: 500,
      creators: [{ address: SELLER, verified: true, share: 100 }],
    });

    const result = parseMetadataCreators(buf);
    expect(result).not.toBeNull();
    expect(result!.sellerFeeBps).toBe(500);
    expect(result!.creators).toHaveLength(1);
    expect(result!.creators[0].address.equals(SELLER)).toBe(true);
    expect(result!.creators[0].verified).toBe(true);
    expect(result!.creators[0].share).toBe(100);
  });

  it("parses metadata with multiple creators", () => {
    const buf = buildMetadataBuffer({
      name: "Collab NFT",
      symbol: "COL",
      uri: "https://example.com",
      sellerFeeBps: 1000,
      creators: [
        { address: SELLER, verified: true, share: 70 },
        { address: BIDDER, verified: false, share: 30 },
      ],
    });

    const result = parseMetadataCreators(buf);
    expect(result).not.toBeNull();
    expect(result!.sellerFeeBps).toBe(1000);
    expect(result!.creators).toHaveLength(2);
    expect(result!.creators[0].share).toBe(70);
    expect(result!.creators[1].share).toBe(30);
  });

  it("parses metadata with no creators", () => {
    const buf = buildMetadataBuffer({
      name: "No Creator",
      symbol: "NC",
      uri: "https://x.com",
      sellerFeeBps: 250,
    });

    const result = parseMetadataCreators(buf);
    expect(result).not.toBeNull();
    expect(result!.sellerFeeBps).toBe(250);
    expect(result!.creators).toHaveLength(0);
  });

  it("returns null for truncated data", () => {
    expect(parseMetadataCreators(Buffer.alloc(10))).toBeNull();
  });

  it("returns null for empty buffer", () => {
    expect(parseMetadataCreators(Buffer.alloc(0))).toBeNull();
  });
});
