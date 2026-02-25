use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

use crate::{
    constants::*,
    errors::OutcryError,
    events::AuctionCreated,
    state::{AuctionState, AuctionStatus, AuctionVault},
};

#[derive(Accounts)]
pub struct CreateAuction<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    #[account(
        constraint = nft_mint.decimals == 0 @ OutcryError::InvalidNftMint,
    )]
    pub nft_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = nft_mint,
        associated_token::authority = seller,
        constraint = seller_nft_token_account.amount == 1,
    )]
    pub seller_nft_token_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = seller,
        associated_token::mint = nft_mint,
        associated_token::authority = auction_state,
    )]
    pub escrow_nft_token_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = seller,
        space = AuctionState::SPACE,
        seeds = [AUCTION_SEED, seller.key().as_ref(), nft_mint.key().as_ref()],
        bump,
    )]
    pub auction_state: Account<'info, AuctionState>,

    #[account(
        init,
        payer = seller,
        space = 8 + AuctionVault::INIT_SPACE,
        seeds = [VAULT_SEED, auction_state.key().as_ref()],
        bump,
    )]
    pub auction_vault: Account<'info, AuctionVault>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_auction(
    ctx: Context<CreateAuction>,
    reserve_price: u64,
    duration_seconds: u64,
    extension_seconds: u32,
    extension_window: u32,
    min_bid_increment: u64,
) -> Result<()> {
    require!(reserve_price > 0, OutcryError::InvalidReservePrice);
    require!(
        duration_seconds >= MIN_AUCTION_DURATION && duration_seconds <= MAX_AUCTION_DURATION,
        OutcryError::InvalidDuration
    );
    require!(min_bid_increment > 0, OutcryError::InvalidBidIncrement);

    let auction_state = &mut ctx.accounts.auction_state;
    auction_state.seller = ctx.accounts.seller.key();
    auction_state.nft_mint = ctx.accounts.nft_mint.key();
    auction_state.reserve_price = reserve_price;
    auction_state.duration_seconds = duration_seconds;
    auction_state.current_bid = 0;
    auction_state.highest_bidder = Pubkey::default();
    auction_state.start_time = 0;
    auction_state.end_time = 0;
    auction_state.extension_seconds = extension_seconds;
    auction_state.extension_window = extension_window;
    auction_state.min_bid_increment = min_bid_increment;
    auction_state.status = AuctionStatus::Created;
    auction_state.bid_count = 0;
    auction_state.bump = ctx.bumps.auction_state;

    let vault = &mut ctx.accounts.auction_vault;
    vault.auction = auction_state.key();
    vault.bump = ctx.bumps.auction_vault;

    // Escrow the NFT
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.seller_nft_token_account.to_account_info(),
                to: ctx.accounts.escrow_nft_token_account.to_account_info(),
                authority: ctx.accounts.seller.to_account_info(),
            },
        ),
        1,
    )?;

    emit!(AuctionCreated {
        auction: auction_state.key(),
        seller: auction_state.seller,
        nft_mint: auction_state.nft_mint,
        reserve_price,
        duration_seconds,
    });

    Ok(())
}
