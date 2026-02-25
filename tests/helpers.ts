import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Outcry } from "../target/types/outcry";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  Transaction,
  sendAndConfirmTransaction,
  Connection,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getAssociatedTokenAddress,
  createAssociatedTokenAccount,
} from "@solana/spl-token";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

export const SYSVAR_RENT = new PublicKey(
  "SysvarRent111111111111111111111111111111111"
);

export const PROTOCOL_TREASURY = new PublicKey(
  "B6MtVeqn7BrJ8HTX6CeP8VugNWyCqqbfcDMxYBknzPt7"
);

// ---------------------------------------------------------------------------
// PDA Helpers
// ---------------------------------------------------------------------------

export function getAuctionPDA(
  seller: PublicKey,
  mint: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("auction"), seller.toBuffer(), mint.toBuffer()],
    programId
  );
}

export function getVaultPDA(
  auctionState: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), auctionState.toBuffer()],
    programId
  );
}

export function getDepositPDA(
  auctionState: PublicKey,
  bidder: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("deposit"), auctionState.toBuffer(), bidder.toBuffer()],
    programId
  );
}

export function getMetadataPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
}

// ---------------------------------------------------------------------------
// Metaplex metadata helper — builds CreateMetadataAccountV3 instruction
// ---------------------------------------------------------------------------

export function createMetadataV3Instruction(
  metadataPda: PublicKey,
  mint: PublicKey,
  mintAuthority: PublicKey,
  payer: PublicKey,
  updateAuthority: PublicKey,
  name: string,
  symbol: string,
  uri: string,
  sellerFeeBps: number,
  creators: { address: PublicKey; verified: boolean; share: number }[]
): TransactionInstruction {
  const nameBytes = Buffer.from(name);
  const symbolBytes = Buffer.from(symbol);
  const uriBytes = Buffer.from(uri);

  const hasCreators = creators.length > 0;

  const size =
    1 +
    4 + nameBytes.length +
    4 + symbolBytes.length +
    4 + uriBytes.length +
    2 +
    1 +
    (hasCreators ? 4 + creators.length * 34 : 0) +
    1 + 1 + 1 + 1;

  const data = Buffer.alloc(size);
  let offset = 0;

  data.writeUInt8(33, offset); offset += 1;

  data.writeUInt32LE(nameBytes.length, offset); offset += 4;
  nameBytes.copy(data, offset); offset += nameBytes.length;

  data.writeUInt32LE(symbolBytes.length, offset); offset += 4;
  symbolBytes.copy(data, offset); offset += symbolBytes.length;

  data.writeUInt32LE(uriBytes.length, offset); offset += 4;
  uriBytes.copy(data, offset); offset += uriBytes.length;

  data.writeUInt16LE(sellerFeeBps, offset); offset += 2;

  if (hasCreators) {
    data.writeUInt8(1, offset); offset += 1;
    data.writeUInt32LE(creators.length, offset); offset += 4;
    for (const c of creators) {
      c.address.toBuffer().copy(data, offset); offset += 32;
      data.writeUInt8(c.verified ? 1 : 0, offset); offset += 1;
      data.writeUInt8(c.share, offset); offset += 1;
    }
  } else {
    data.writeUInt8(0, offset); offset += 1;
  }

  data.writeUInt8(0, offset); offset += 1; // collection: None
  data.writeUInt8(0, offset); offset += 1; // uses: None
  data.writeUInt8(1, offset); offset += 1; // is_mutable: true
  data.writeUInt8(0, offset); offset += 1; // collection_details: None

  return new TransactionInstruction({
    programId: TOKEN_METADATA_PROGRAM_ID,
    keys: [
      { pubkey: metadataPda, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: mintAuthority, isSigner: true, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: updateAuthority, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ---------------------------------------------------------------------------
// Test NFT creation helper
// ---------------------------------------------------------------------------

export interface TestNft {
  mint: PublicKey;
  ownerAta: PublicKey;
  metadata: PublicKey;
}

export async function createTestNft(
  connection: Connection,
  payer: Keypair,
  opts?: {
    owner?: Keypair;
    mintAuthority?: Keypair;
    sellerFeeBps?: number;
    creators?: { address: PublicKey; verified: boolean; share: number }[];
    name?: string;
    symbol?: string;
    uri?: string;
  }
): Promise<TestNft> {
  const owner = opts?.owner ?? payer;
  const mintAuthority = opts?.mintAuthority ?? payer;
  const sellerFeeBps = opts?.sellerFeeBps ?? 500;
  const creators = opts?.creators ?? [
    { address: mintAuthority.publicKey, verified: true, share: 100 },
  ];
  const name = opts?.name ?? "Test NFT";
  const symbol = opts?.symbol ?? "TEST";
  const uri = opts?.uri ?? "https://example.com/test.json";

  // Create 0-decimal mint
  const mint = await createMint(
    connection,
    payer,
    mintAuthority.publicKey,
    null,
    0
  );

  // Create owner ATA and mint 1 token
  const ownerAta = await createAssociatedTokenAccount(
    connection,
    payer,
    mint,
    owner.publicKey
  );
  await mintTo(connection, payer, mint, ownerAta, mintAuthority, 1);

  // Create Metaplex metadata
  const [metadata] = getMetadataPDA(mint);
  const metaIx = createMetadataV3Instruction(
    metadata,
    mint,
    mintAuthority.publicKey,
    payer.publicKey,
    mintAuthority.publicKey,
    name,
    symbol,
    uri,
    sellerFeeBps,
    creators
  );
  const tx = new Transaction().add(metaIx);
  const signers = [payer];
  if (mintAuthority !== payer) signers.push(mintAuthority);
  await sendAndConfirmTransaction(connection, tx, signers);

  return { mint, ownerAta, metadata };
}

// ---------------------------------------------------------------------------
// Full auction setup helper
// ---------------------------------------------------------------------------

export interface AuctionSetup {
  seller: Keypair;
  nftMint: PublicKey;
  sellerNftAta: PublicKey;
  nftMetadata: PublicKey;
  auctionState: PublicKey;
  auctionVault: PublicKey;
  escrowNftAta: PublicKey;
}

export async function setupAuction(
  program: Program<Outcry>,
  connection: Connection,
  seller: Keypair,
  opts?: {
    mintAuthority?: Keypair;
    sellerFeeBps?: number;
    creators?: { address: PublicKey; verified: boolean; share: number }[];
    reservePrice?: anchor.BN;
    durationSeconds?: anchor.BN;
    extensionSeconds?: number;
    extensionWindow?: number;
    minBidIncrement?: anchor.BN;
  }
): Promise<AuctionSetup> {
  const mintAuthority = opts?.mintAuthority ?? seller;

  const nft = await createTestNft(connection, seller, {
    owner: seller,
    mintAuthority,
    sellerFeeBps: opts?.sellerFeeBps,
    creators: opts?.creators,
  });

  const [auctionState] = getAuctionPDA(
    seller.publicKey,
    nft.mint,
    program.programId
  );
  const [auctionVault] = getVaultPDA(auctionState, program.programId);
  const escrowNftAta = await getAssociatedTokenAddress(
    nft.mint,
    auctionState,
    true
  );

  await program.methods
    .createAuction(
      opts?.reservePrice ?? new anchor.BN(1 * LAMPORTS_PER_SOL),
      opts?.durationSeconds ?? new anchor.BN(5),
      opts?.extensionSeconds ?? 2,
      opts?.extensionWindow ?? 2,
      opts?.minBidIncrement ?? new anchor.BN(0.1 * LAMPORTS_PER_SOL)
    )
    .accountsStrict({
      seller: seller.publicKey,
      nftMint: nft.mint,
      sellerNftTokenAccount: nft.ownerAta,
      escrowNftTokenAccount: escrowNftAta,
      auctionState,
      auctionVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([seller])
    .rpc();

  return {
    seller,
    nftMint: nft.mint,
    sellerNftAta: nft.ownerAta,
    nftMetadata: nft.metadata,
    auctionState,
    auctionVault,
    escrowNftAta,
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
