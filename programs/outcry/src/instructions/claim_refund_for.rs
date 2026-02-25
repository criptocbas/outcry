use anchor_lang::prelude::*;

use crate::{
    constants::*,
    errors::OutcryError,
    events::RefundClaimed,
    state::{AuctionState, AuctionStatus, AuctionVault, BidderDeposit},
};

#[derive(Accounts)]
pub struct ClaimRefundFor<'info> {
    /// Anyone can pay the transaction fee (typically the seller).
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: The bidder receiving the refund. Not a signer — validated
    /// implicitly via the BidderDeposit PDA seed derivation below.
    #[account(mut)]
    pub bidder: UncheckedAccount<'info>,

    #[account(
        constraint = auction_state.status == AuctionStatus::Settled
            || auction_state.status == AuctionStatus::Cancelled
            @ OutcryError::RefundNotAvailable,
    )]
    pub auction_state: Account<'info, AuctionState>,

    #[account(
        mut,
        seeds = [DEPOSIT_SEED, auction_state.key().as_ref(), bidder.key().as_ref()],
        bump = bidder_deposit.bump,
        constraint = bidder_deposit.amount > 0 @ OutcryError::NothingToRefund,
        close = bidder,
    )]
    pub bidder_deposit: Account<'info, BidderDeposit>,

    #[account(
        mut,
        seeds = [VAULT_SEED, auction_state.key().as_ref()],
        bump = auction_vault.bump,
    )]
    pub auction_vault: Account<'info, AuctionVault>,

    pub system_program: Program<'info, System>,
}

pub fn handle_claim_refund_for(ctx: Context<ClaimRefundFor>) -> Result<()> {
    let deposit = &mut ctx.accounts.bidder_deposit;
    let refund_amount = deposit.amount;
    let bidder_key = ctx.accounts.bidder.key();
    let auction_key = ctx.accounts.auction_state.key();

    // Zero out the deposit
    deposit.amount = 0;

    // Transfer SOL from vault to bidder
    let vault_info = ctx.accounts.auction_vault.to_account_info();
    let bidder_info = ctx.accounts.bidder.to_account_info();

    **vault_info.try_borrow_mut_lamports()? -= refund_amount;
    **bidder_info.try_borrow_mut_lamports()? += refund_amount;

    emit!(RefundClaimed {
        auction: auction_key,
        bidder: bidder_key,
        amount: refund_amount,
    });

    Ok(())
}
