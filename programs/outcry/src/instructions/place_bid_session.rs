use anchor_lang::prelude::*;

use crate::{
    constants::SESSION_SEED,
    errors::OutcryError,
    events::BidPlaced,
    state::{AuctionState, AuctionStatus, SessionToken},
};

#[derive(Accounts)]
pub struct PlaceBidSession<'info> {
    /// The ephemeral browser keypair — signs tx without wallet popup.
    pub session_signer: Signer<'info>,

    /// Session token proving the ephemeral key is authorized by a real wallet.
    /// Lives on L1 (never delegated). ER clones it as read-only.
    #[account(
        seeds = [SESSION_SEED, auction_state.key().as_ref(), session_token.bidder.as_ref()],
        bump = session_token.bump,
        constraint = session_token.session_signer == session_signer.key() @ OutcryError::SessionSignerMismatch,
        constraint = session_token.auction == auction_state.key() @ OutcryError::SessionBidderMismatch,
    )]
    pub session_token: Account<'info, SessionToken>,

    #[account(
        mut,
        constraint = auction_state.status == AuctionStatus::Active @ OutcryError::InvalidAuctionStatus,
        constraint = auction_state.seller != session_token.bidder @ OutcryError::SellerCannotBid,
    )]
    pub auction_state: Account<'info, AuctionState>,
}

pub fn handle_place_bid_session(ctx: Context<PlaceBidSession>, amount: u64) -> Result<()> {
    let clock = Clock::get()?;
    let auction = &mut ctx.accounts.auction_state;
    // Use the REAL wallet identity from the session token
    let bidder_key = ctx.accounts.session_token.bidder;

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

    let previous_bid = auction.current_bid;

    auction.current_bid = amount;
    auction.highest_bidder = bidder_key; // REAL wallet — correct for settlement
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
        let max_extension = std::cmp::min(auction.duration_seconds as i64, 3600);
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
        bidder: bidder_key, // REAL wallet for event consumers
        amount,
        previous_bid,
        bid_count: auction.bid_count,
        new_end_time: auction.end_time,
    });

    Ok(())
}
