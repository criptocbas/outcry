use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::{
    constants::*,
    errors::OutcryError,
    state::{AuctionState, AuctionStatus, AuctionVault},
};

#[derive(Accounts)]
pub struct CloseAuction<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    #[account(
        mut,
        has_one = seller @ OutcryError::UnauthorizedSeller,
        constraint = auction_state.status == AuctionStatus::Settled
            || auction_state.status == AuctionStatus::Cancelled
            @ OutcryError::InvalidAuctionStatus,
        seeds = [AUCTION_SEED, seller.key().as_ref(), nft_mint.key().as_ref()],
        bump = auction_state.bump,
        close = seller,
    )]
    pub auction_state: Account<'info, AuctionState>,

    #[account(
        mut,
        seeds = [VAULT_SEED, auction_state.key().as_ref()],
        bump = auction_vault.bump,
        close = seller,
    )]
    pub auction_vault: Account<'info, AuctionVault>,

    pub nft_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = nft_mint,
        associated_token::authority = auction_state,
    )]
    pub escrow_nft_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handle_close_auction(ctx: Context<CloseAuction>) -> Result<()> {
    let auction = &ctx.accounts.auction_state;

    // NOTE: With separate BidderDeposit PDAs, outstanding deposit tracking
    // is no longer embedded in AuctionState. Bidders close their own deposit
    // accounts via claim_refund. The vault must be empty to close.

    // Ensure escrow is empty (NFT already transferred or returned)
    require!(
        ctx.accounts.escrow_nft_token_account.amount == 0,
        OutcryError::EscrowNotEmpty
    );

    // Close escrow token account via PDA-signed CPI — must happen before
    // Anchor's `close` constraint zeroes the AuctionState PDA at exit.
    let seller_key = auction.seller;
    let nft_mint_key = ctx.accounts.nft_mint.key();
    let bump = auction.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        AUCTION_SEED,
        seller_key.as_ref(),
        nft_mint_key.as_ref(),
        &[bump],
    ]];

    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        token::CloseAccount {
            account: ctx.accounts.escrow_nft_token_account.to_account_info(),
            destination: ctx.accounts.seller.to_account_info(),
            authority: ctx.accounts.auction_state.to_account_info(),
        },
        signer_seeds,
    ))?;

    // AuctionState and AuctionVault are closed by Anchor's `close` constraint.
    // All rent-exempt lamports are returned to seller.

    Ok(())
}
