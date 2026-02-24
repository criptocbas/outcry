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

/// Handles the case where the winning bidder didn't deposit enough to cover
/// their bid (griefing/default). Returns NFT to seller, forfeits whatever
/// deposit the winner had as a penalty, and sets status to Settled so
/// other bidders can claim refunds.
#[derive(Accounts)]
pub struct ForfeitAuction<'info> {
    /// Anyone can crank this — permissionless
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

    /// CHECK: Winner's deposit PDA — may not exist if winner never deposited.
    /// PDA derivation validated via seeds. Deserialized manually in handler.
    #[account(
        mut,
        seeds = [DEPOSIT_SEED, auction_state.key().as_ref(), auction_state.highest_bidder.as_ref()],
        bump,
    )]
    pub winner_deposit: UncheckedAccount<'info>,

    /// CHECK: Validated against auction_state.seller
    #[account(
        mut,
        constraint = seller.key() == auction_state.seller,
    )]
    pub seller: UncheckedAccount<'info>,

    pub nft_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = nft_mint,
        associated_token::authority = auction_state,
    )]
    pub escrow_nft_token_account: Account<'info, TokenAccount>,

    // SAFETY: init_if_needed for seller ATA — same safety rationale as settle_auction.
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = nft_mint,
        associated_token::authority = seller,
    )]
    pub seller_nft_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_forfeit_auction(ctx: Context<ForfeitAuction>) -> Result<()> {
    // ATOMIC: Set Settled immediately to prevent double-forfeit attacks.
    ctx.accounts.auction_state.status = AuctionStatus::Settled;

    let winning_bid = ctx.accounts.auction_state.current_bid;
    let highest_bidder = ctx.accounts.auction_state.highest_bidder;
    let seller_key = ctx.accounts.auction_state.seller;
    let nft_mint_key = ctx.accounts.nft_mint.key();
    let bump = ctx.accounts.auction_state.bump;

    // Read winner's deposit amount (0 if they never deposited)
    let winner_deposit_amount = if !ctx.accounts.winner_deposit.data_is_empty() {
        let data = ctx.accounts.winner_deposit.try_borrow_data()?;
        let mut slice: &[u8] = &data;
        let deposit = BidderDeposit::try_deserialize(&mut slice)?;
        drop(data);
        deposit.amount
    } else {
        0
    };

    // This instruction is only valid when winner CAN'T cover their bid
    require!(
        winner_deposit_amount < winning_bid,
        OutcryError::ForfeitNotNeeded
    );

    // Forfeit winner's deposit to seller as penalty (if any)
    if winner_deposit_amount > 0 {
        let vault_info = ctx.accounts.auction_vault.to_account_info();
        let seller_info = ctx.accounts.seller.to_account_info();

        **vault_info.try_borrow_mut_lamports()? -= winner_deposit_amount;
        **seller_info.try_borrow_mut_lamports()? += winner_deposit_amount;

        // Zero out the deposit so winner can't also claim a refund.
        // Use proper Anchor serialization to avoid fragile hardcoded offsets.
        let mut data = ctx.accounts.winner_deposit.try_borrow_mut_data()?;
        let mut slice: &[u8] = &data;
        let mut deposit = BidderDeposit::try_deserialize(&mut slice)
            .map_err(|_| error!(OutcryError::InvalidAuctionStatus))?;
        deposit.amount = 0;
        let mut writer: &mut [u8] = &mut data[..];
        deposit.try_serialize(&mut writer)?;
        drop(data);
    }

    // Return NFT from escrow to seller
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

    emit!(AuctionSettled {
        auction: ctx.accounts.auction_state.key(),
        winner: highest_bidder,
        final_price: 0, // No sale — winner defaulted
        seller_received: winner_deposit_amount, // Forfeited deposit as penalty
        royalties_paid: 0,
    });

    Ok(())
}
