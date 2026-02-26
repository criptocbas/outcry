use anchor_lang::prelude::*;

#[event]
pub struct AuctionCreated {
    pub auction: Pubkey,
    pub seller: Pubkey,
    pub nft_mint: Pubkey,
    pub reserve_price: u64,
    pub duration_seconds: u64,
}

#[event]
pub struct AuctionStarted {
    pub auction: Pubkey,
    pub start_time: i64,
    pub end_time: i64,
}

#[event]
pub struct BidPlaced {
    pub auction: Pubkey,
    pub bidder: Pubkey,
    pub amount: u64,
    pub previous_bid: u64,
    pub bid_count: u32,
    pub new_end_time: i64,
}

#[event]
pub struct AuctionEnded {
    pub auction: Pubkey,
    pub winner: Pubkey,
    pub winning_bid: u64,
    pub total_bids: u32,
}

#[event]
pub struct AuctionSettled {
    pub auction: Pubkey,
    pub winner: Pubkey,
    pub final_price: u64,
    pub seller_received: u64,
    pub royalties_paid: u64,
    pub protocol_fee: u64,
}

#[event]
pub struct DepositMade {
    pub auction: Pubkey,
    pub bidder: Pubkey,
    pub amount: u64,
    pub total_deposit: u64,
}

#[event]
pub struct RefundClaimed {
    pub auction: Pubkey,
    pub bidder: Pubkey,
    pub amount: u64,
}

#[event]
pub struct AuctionCancelled {
    pub auction: Pubkey,
    pub seller: Pubkey,
}

#[event]
pub struct AuctionForceClosed {
    pub auction: Pubkey,
    pub seller: Pubkey,
    pub drained_lamports: u64,
}
