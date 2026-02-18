pub const PROTOCOL_FEE_BPS: u16 = 0; // 0% for hackathon; would be 250 (2.5%) in production

pub const MIN_AUCTION_DURATION: u64 = 5; // 5 seconds (short for testing; increase in production)
pub const MAX_AUCTION_DURATION: u64 = 604_800; // 7 days

pub const MAX_BIDDERS: usize = 20; // Max depositors per auction (keeps account size bounded for ER)

pub const AUCTION_SEED: &[u8] = b"auction";
pub const VAULT_SEED: &[u8] = b"vault";
pub const DEPOSIT_SEED: &[u8] = b"deposit";
