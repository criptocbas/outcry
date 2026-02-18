use anchor_lang::prelude::*;

#[account]
pub struct AuctionState {
    /// The seller / artist who created this auction
    pub seller: Pubkey,
    /// The NFT mint being auctioned
    pub nft_mint: Pubkey,
    /// Minimum acceptable first bid (lamports)
    pub reserve_price: u64,
    /// Auction duration in seconds (set at creation, used by start_auction)
    pub duration_seconds: u64,
    /// Current highest bid amount (lamports), 0 if no bids
    pub current_bid: u64,
    /// Current highest bidder, Pubkey::default() if no bids
    pub highest_bidder: Pubkey,
    /// Unix timestamp when auction went Active (0 if not started)
    pub start_time: i64,
    /// Unix timestamp when auction ends (extended on anti-snipe)
    pub end_time: i64,
    /// Seconds to extend when anti-snipe triggers
    pub extension_seconds: u32,
    /// Window before end_time that triggers anti-snipe extension
    pub extension_window: u32,
    /// Minimum increment over current_bid for a new bid
    pub min_bid_increment: u64,
    /// Auction lifecycle status
    pub status: AuctionStatus,
    /// Total number of bids placed
    pub bid_count: u32,
    /// PDA bump seed
    pub bump: u8,
}

impl AuctionState {
    /// Fixed space: 8 (discriminator) + all fixed-size fields
    pub const SPACE: usize = 8   // discriminator
        + 32   // seller
        + 32   // nft_mint
        + 8    // reserve_price
        + 8    // duration_seconds
        + 8    // current_bid
        + 32   // highest_bidder
        + 8    // start_time
        + 8    // end_time
        + 4    // extension_seconds
        + 4    // extension_window
        + 8    // min_bid_increment
        + 1    // status
        + 4    // bid_count
        + 1;   // bump
}

#[account]
#[derive(InitSpace)]
pub struct AuctionVault {
    /// The parent auction this vault belongs to
    pub auction: Pubkey,
    /// PDA bump seed
    pub bump: u8,
}

/// Per-bidder deposit tracking — lives on L1, never delegated.
/// Seeds: [b"deposit", auction_state.key(), bidder.key()]
#[account]
#[derive(InitSpace)]
pub struct BidderDeposit {
    /// The auction this deposit is for
    pub auction: Pubkey,
    /// The bidder who deposited
    pub bidder: Pubkey,
    /// Total deposited amount (lamports)
    pub amount: u64,
    /// PDA bump seed
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum AuctionStatus {
    /// Auction created, NFT escrowed, accepting deposits
    Created,
    /// Auction live, accepting bids
    Active,
    /// Timer expired, awaiting settlement
    Ended,
    /// NFT transferred, SOL distributed
    Settled,
    /// Seller cancelled (no bids placed)
    Cancelled,
}
