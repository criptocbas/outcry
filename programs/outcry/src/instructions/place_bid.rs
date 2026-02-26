use anchor_lang::prelude::*;

use crate::{
    constants::MAX_EXTENSION_SECONDS,
    errors::OutcryError,
    events::BidPlaced,
    state::{AuctionState, AuctionStatus},
};

#[derive(Accounts)]
pub struct PlaceBid<'info> {
    pub bidder: Signer<'info>,

    #[account(
        mut,
        constraint = auction_state.status == AuctionStatus::Active @ OutcryError::InvalidAuctionStatus,
        constraint = auction_state.seller != bidder.key() @ OutcryError::SellerCannotBid,
    )]
    pub auction_state: Account<'info, AuctionState>,
}

pub fn handle_place_bid(ctx: Context<PlaceBid>, amount: u64) -> Result<()> {
    let clock = Clock::get()?;
    let auction = &mut ctx.accounts.auction_state;
    let bidder_key = ctx.accounts.bidder.key();

    // Verify auction hasn't expired
    require!(
        clock.unix_timestamp < auction.end_time,
        OutcryError::AuctionEnded
    );

    // Validate bid amount
    if auction.bid_count == 0 {
        // First bid must meet reserve
        require!(amount >= auction.reserve_price, OutcryError::BelowReserve);
    } else {
        // Subsequent bids must exceed current + increment
        let min_bid = auction
            .current_bid
            .checked_add(auction.min_bid_increment)
            .ok_or(OutcryError::ArithmeticOverflow)?;
        require!(amount >= min_bid, OutcryError::BidTooLow);
    }

    // NOTE: Deposit validation is deferred to settle_auction on L1.
    // The ER only tracks bid state — actual SOL lives in the L1 vault.
    // Frontend enforces deposit checks client-side before allowing a bid.

    let previous_bid = auction.current_bid;

    auction.current_bid = amount;
    auction.highest_bidder = bidder_key;
    auction.bid_count = auction
        .bid_count
        .checked_add(1)
        .ok_or(OutcryError::ArithmeticOverflow)?;

    // Anti-snipe: extend if bid arrives within extension_window of end.
    // Cap total extensions at original_duration + min(original_duration, 1 hour).
    let time_remaining = auction.end_time
        .checked_sub(clock.unix_timestamp)
        .ok_or(OutcryError::ArithmeticOverflow)?;
    if time_remaining < auction.extension_window as i64 {
        let max_extension = std::cmp::min(auction.duration_seconds as i64, MAX_EXTENSION_SECONDS);
        let max_end_time = auction
            .start_time
            .checked_add(auction.duration_seconds as i64)
            .ok_or(OutcryError::ArithmeticOverflow)?
            .checked_add(max_extension)
            .ok_or(OutcryError::ArithmeticOverflow)?;
        let proposed_end = auction
            .end_time
            .checked_add(auction.extension_seconds as i64)
            .ok_or(OutcryError::ArithmeticOverflow)?;
        auction.end_time = proposed_end.min(max_end_time);
    }

    emit!(BidPlaced {
        auction: auction.key(),
        bidder: bidder_key,
        amount,
        previous_bid,
        bid_count: auction.bid_count,
        new_end_time: auction.end_time,
    });

    Ok(())
}
