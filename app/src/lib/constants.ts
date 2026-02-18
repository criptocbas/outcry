import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

// Program IDs
export const PROGRAM_ID = new PublicKey(
  "J7r5mzvVUjSNQteoqn6Hd3LjZ3ksmwoD5xsnUvMJwPZo"
);

export const DELEGATION_PROGRAM_ID = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
);

// RPC Endpoints
export const DEVNET_RPC = "https://api.devnet.solana.com";
export const MAGIC_ROUTER_RPC = "https://devnet-router.magicblock.app/";
export const MAGIC_ROUTER_WS = "wss://devnet-router.magicblock.app/";

// PDA Seeds
export const AUCTION_SEED = Buffer.from("auction");
export const VAULT_SEED = Buffer.from("vault");
export const DEPOSIT_SEED = Buffer.from("deposit");
// Protocol Constants
export const PROTOCOL_FEE_BPS = 250; // 2.5%
export const DEFAULT_EXTENSION_SECONDS = 300; // 5 min
export const DEFAULT_EXTENSION_WINDOW = 300; // 5 min
export const DEFAULT_MIN_BID_INCREMENT = 100_000_000; // 0.1 SOL in lamports
export const MIN_AUCTION_DURATION = 300; // 5 min
export const MAX_AUCTION_DURATION = 604_800; // 7 days

// Bubblegum / Badge Constants
export const BUBBLEGUM_PROGRAM_ID_STR =
  "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY";

// Badge Merkle Tree (set after creation via createBadgeTree)
// For hackathon: tree creator's wallet becomes tree authority.
export const BADGE_MERKLE_TREE =
  process.env.NEXT_PUBLIC_BADGE_MERKLE_TREE ?? "";

// Tree parameters
export const BADGE_TREE_MAX_DEPTH = 14; // 16,384 max badges
export const BADGE_TREE_MAX_BUFFER = 64;
export const BADGE_TREE_CANOPY_DEPTH = 11;

// Helius RPC (DAS API support required for cNFT fetching)
export const HELIUS_RPC =
  process.env.NEXT_PUBLIC_HELIUS_RPC || DEVNET_RPC;

// Re-export for convenience
export { LAMPORTS_PER_SOL };
