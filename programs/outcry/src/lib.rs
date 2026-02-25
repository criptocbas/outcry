use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("J7r5mzvVUjSNQteoqn6Hd3LjZ3ksmwoD5xsnUvMJwPZo");

#[ephemeral]
#[program]
pub mod outcry {
    use super::*;

    pub fn create_auction(
        ctx: Context<CreateAuction>,
        reserve_price: u64,
        duration_seconds: u64,
        extension_seconds: u32,
        extension_window: u32,
        min_bid_increment: u64,
    ) -> Result<()> {
        instructions::create_auction::handle_create_auction(
            ctx,
            reserve_price,
            duration_seconds,
            extension_seconds,
            extension_window,
            min_bid_increment,
        )
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handle_deposit(ctx, amount)
    }

    /// Sets auction to Active with start/end times. Call on L1.
    pub fn start_auction(ctx: Context<StartAuction>) -> Result<()> {
        instructions::start_auction::handle_start_auction(ctx)
    }

    /// Delegates AuctionState to the Ephemeral Rollup. Call on L1 after start_auction.
    pub fn delegate_auction(ctx: Context<DelegateAuction>, nft_mint: Pubkey) -> Result<()> {
        instructions::delegate_auction::handle_delegate_auction(ctx, nft_mint)
    }

    /// Places a bid. Call on ER (sub-50ms) when delegated, or L1 if not.
    pub fn place_bid(ctx: Context<PlaceBid>, amount: u64) -> Result<()> {
        instructions::place_bid::handle_place_bid(ctx, amount)
    }

    /// Sets auction to Ended. Call on ER when delegated, or L1 if not.
    pub fn end_auction(ctx: Context<EndAuction>) -> Result<()> {
        instructions::end_auction::handle_end_auction(ctx)
    }

    /// Commits state and undelegates AuctionState back to L1. Call on ER after end_auction.
    pub fn undelegate_auction(ctx: Context<UndelegateAuction>) -> Result<()> {
        instructions::undelegate_auction::handle_undelegate_auction(ctx)
    }

    pub fn settle_auction(ctx: Context<SettleAuction>) -> Result<()> {
        instructions::settle_auction::handle_settle_auction(ctx)
    }

    pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
        instructions::claim_refund::handle_claim_refund(ctx)
    }

    pub fn cancel_auction(ctx: Context<CancelAuction>) -> Result<()> {
        instructions::cancel_auction::handle_cancel_auction(ctx)
    }

    /// Closes AuctionState, AuctionVault, and escrow ATA after all refunds are claimed.
    /// Returns rent-exempt lamports to the seller.
    pub fn close_auction(ctx: Context<CloseAuction>) -> Result<()> {
        instructions::close_auction::handle_close_auction(ctx)
    }

    /// Handles a defaulted auction where the winner's deposit is insufficient.
    /// Returns NFT to seller, forfeits winner's deposit as penalty, sets Settled
    /// so other bidders can claim refunds.
    pub fn forfeit_auction(ctx: Context<ForfeitAuction>) -> Result<()> {
        instructions::forfeit_auction::handle_forfeit_auction(ctx)
    }

    /// Force-closes an auction after the 7-day grace period.
    /// Drains any unclaimed deposits from the vault to the seller and closes
    /// all accounts. Use when bidders haven't claimed refunds and the seller's
    /// accounts are stuck.
    pub fn force_close_auction(ctx: Context<ForceCloseAuction>) -> Result<()> {
        instructions::force_close_auction::handle_force_close_auction(ctx)
    }
}
