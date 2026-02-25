use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::{
    constants::*,
    errors::OutcryError,
    events::AuctionCancelled,
    state::{AuctionState, AuctionStatus},
};

#[derive(Accounts)]
pub struct CancelAuction<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    #[account(
        mut,
        seeds = [AUCTION_SEED, seller.key().as_ref(), auction_state.nft_mint.as_ref()],
        bump = auction_state.bump,
        has_one = seller @ OutcryError::UnauthorizedSeller,
    )]
    pub auction_state: Account<'info, AuctionState>,

    pub nft_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = nft_mint,
        associated_token::authority = auction_state,
    )]
    pub escrow_nft_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = nft_mint,
        associated_token::authority = seller,
    )]
    pub seller_nft_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handle_cancel_auction(ctx: Context<CancelAuction>) -> Result<()> {
    let auction = &ctx.accounts.auction_state;

    // Can cancel if Created, or if Ended with no bids
    require!(
        auction.status == AuctionStatus::Created
            || (auction.status == AuctionStatus::Ended && auction.bid_count == 0),
        OutcryError::InvalidAuctionStatus
    );

    // Return NFT to seller
    let seller_key = ctx.accounts.seller.key();
    let nft_mint_key = ctx.accounts.nft_mint.key();
    let bump = ctx.accounts.auction_state.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        AUCTION_SEED,
        seller_key.as_ref(),
        nft_mint_key.as_ref(),
        &[bump],
    ]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.escrow_nft_token_account.to_account_info(),
                to: ctx.accounts.seller_nft_token_account.to_account_info(),
                authority: ctx.accounts.auction_state.to_account_info(),
            },
            signer_seeds,
        ),
        1,
    )?;

    ctx.accounts.auction_state.status = AuctionStatus::Cancelled;

    emit!(AuctionCancelled {
        auction: ctx.accounts.auction_state.key(),
        seller: ctx.accounts.seller.key(),
    });

    Ok(())
}
