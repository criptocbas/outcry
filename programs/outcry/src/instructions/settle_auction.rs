use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

use crate::{
    constants::*,
    errors::OutcryError,
    events::AuctionSettled,
    state::{AuctionState, AuctionStatus, AuctionVault, BidderDeposit},
};

#[derive(Accounts)]
pub struct SettleAuction<'info> {
    /// Anyone can crank settlement — permissionless
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        constraint = auction_state.status == AuctionStatus::Ended @ OutcryError::InvalidAuctionStatus,
        constraint = auction_state.bid_count > 0 @ OutcryError::CannotCancelWithBids,
    )]
    pub auction_state: Account<'info, AuctionState>,

    #[account(
        mut,
        seeds = [VAULT_SEED, auction_state.key().as_ref()],
        bump = auction_vault.bump,
    )]
    pub auction_vault: Account<'info, AuctionVault>,

    /// Winner's deposit PDA — validates they deposited enough
    #[account(
        mut,
        seeds = [DEPOSIT_SEED, auction_state.key().as_ref(), auction_state.highest_bidder.as_ref()],
        bump = winner_deposit.bump,
        constraint = winner_deposit.amount >= auction_state.current_bid
            @ OutcryError::InsufficientDeposit,
    )]
    pub winner_deposit: Account<'info, BidderDeposit>,

    /// CHECK: Validated against auction_state.seller
    #[account(
        mut,
        constraint = seller.key() == auction_state.seller,
    )]
    pub seller: UncheckedAccount<'info>,

    /// CHECK: Validated against auction_state.highest_bidder
    #[account(
        mut,
        constraint = winner.key() == auction_state.highest_bidder,
    )]
    pub winner: UncheckedAccount<'info>,

    pub nft_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = nft_mint,
        associated_token::authority = auction_state,
    )]
    pub escrow_nft_token_account: Account<'info, TokenAccount>,

    // SAFETY: init_if_needed is used here because the winner may or may not already
    // have an ATA for this NFT mint. This is safe for ATAs — the address is derived
    // deterministically from (wallet, mint, token_program), and "re-creating" an
    // existing ATA is a no-op. The reinitialization attack vector only applies to
    // program-owned accounts, not token-program-owned ATAs.
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = nft_mint,
        associated_token::authority = winner,
    )]
    pub winner_nft_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_settle_auction(ctx: Context<SettleAuction>) -> Result<()> {
    let auction = &mut ctx.accounts.auction_state;
    let winning_bid = auction.current_bid;
    let winner_key = auction.highest_bidder;

    // Deduct winning bid from winner's deposit
    let winner_deposit = &mut ctx.accounts.winner_deposit;
    winner_deposit.amount = winner_deposit
        .amount
        .checked_sub(winning_bid)
        .ok_or(OutcryError::ArithmeticOverflow)?;

    // --- Distribute SOL from vault to seller ---
    // TODO: Add royalty distribution from Metaplex metadata once toolchain supports it.
    //       For now, full winning bid goes to seller.
    let seller_receives = winning_bid;
    let royalties_paid: u64 = 0;

    let vault_info = ctx.accounts.auction_vault.to_account_info();
    let seller_info = ctx.accounts.seller.to_account_info();

    **vault_info.try_borrow_mut_lamports()? -= seller_receives;
    **seller_info.try_borrow_mut_lamports()? += seller_receives;

    // --- Transfer NFT from escrow to winner ---
    let seller_key = auction.seller;
    let nft_mint_key = ctx.accounts.nft_mint.key();
    let bump = auction.bump;
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
                to: ctx.accounts.winner_nft_token_account.to_account_info(),
                authority: ctx.accounts.auction_state.to_account_info(),
            },
            signer_seeds,
        ),
        1,
    )?;

    // --- Update auction status ---
    ctx.accounts.auction_state.status = AuctionStatus::Settled;

    emit!(AuctionSettled {
        auction: ctx.accounts.auction_state.key(),
        winner: winner_key,
        final_price: winning_bid,
        seller_received: seller_receives,
        royalties_paid,
    });

    Ok(())
}
