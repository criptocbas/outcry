use anchor_lang::prelude::Pubkey;

pub const PROTOCOL_FEE_BPS: u16 = 0; // 0% for hackathon; would be 250 (2.5%) in production

/// Metaplex Token Metadata program ID (for cross-program PDA validation).
/// Defined as a plain constant to avoid `declare_id!` polluting the Anchor IDL.
pub const TOKEN_METADATA_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    11, 112, 101, 177, 227, 209, 124, 69, 56, 157, 82, 127, 107, 4, 195, 205,
    88, 184, 108, 115, 26, 160, 253, 181, 73, 182, 209, 188, 3, 248, 41, 70,
]);

pub const MIN_AUCTION_DURATION: u64 = 5; // 5 seconds (short for testing; increase in production)
pub const MAX_AUCTION_DURATION: u64 = 604_800; // 7 days

pub const AUCTION_SEED: &[u8] = b"auction";
pub const VAULT_SEED: &[u8] = b"vault";
pub const DEPOSIT_SEED: &[u8] = b"deposit";
