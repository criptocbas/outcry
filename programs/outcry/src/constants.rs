use anchor_lang::prelude::Pubkey;

pub const PROTOCOL_FEE_BPS: u16 = 250; // 2.5%

/// Protocol treasury — receives protocol fees at settlement.
pub const PROTOCOL_TREASURY: Pubkey = Pubkey::new_from_array([
    149, 244, 100, 41, 6, 97, 224, 199,
    172, 148, 20, 37, 51, 40, 133, 116,
    76, 82, 205, 162, 197, 14, 242, 115,
    151, 186, 63, 255, 146, 232, 88, 68,
]);

/// Metaplex Token Metadata program ID (for cross-program PDA validation).
/// Defined as a plain constant to avoid `declare_id!` polluting the Anchor IDL.
pub const TOKEN_METADATA_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    11, 112, 101, 177, 227, 209, 124, 69, 56, 157, 82, 127, 107, 4, 195, 205,
    88, 184, 108, 115, 26, 160, 253, 181, 73, 182, 209, 188, 3, 248, 41, 70,
]);

pub const MIN_AUCTION_DURATION: u64 = 300; // 5 minutes
pub const MAX_AUCTION_DURATION: u64 = 604_800; // 7 days

pub const AUCTION_SEED: &[u8] = b"auction";
pub const VAULT_SEED: &[u8] = b"vault";
pub const DEPOSIT_SEED: &[u8] = b"deposit";
