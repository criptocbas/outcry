use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::{
    constants::*,
    errors::OutcryError,
    state::{AuctionState, AuctionStatus, AuctionVault},
};

#[derive(Accounts)]
pub struct ForceCloseAuction<'info> {
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
    pub system_program: Program<'info, System>,
}

pub fn handle_force_close_auction(ctx: Context<ForceCloseAuction>) -> Result<()> {
    let auction = &ctx.accounts.auction_state;
    let clock = Clock::get()?;

    // Grace period check — give bidders time to claim refunds before
    // the seller can sweep unclaimed deposits.
    let grace_deadline = match auction.status {
        AuctionStatus::Settled => {
            // After settlement, grace = end_time + 7 days
            auction.end_time.checked_add(FORCE_CLOSE_GRACE_PERIOD)
                .ok_or(OutcryError::ArithmeticOverflow)?
        }
        AuctionStatus::Cancelled => {
            if auction.start_time == 0 {
                // Cancelled before starting — no bids possible, allow immediately
                0
            } else {
                // Cancelled after starting — grace = start_time + 7 days
                auction.start_time.checked_add(FORCE_CLOSE_GRACE_PERIOD)
                    .ok_or(OutcryError::ArithmeticOverflow)?
            }
        }
        _ => return err!(OutcryError::InvalidAuctionStatus),
    };

    require!(
        clock.unix_timestamp >= grace_deadline,
        OutcryError::GracePeriodNotElapsed
    );

    // Ensure escrow is empty (NFT already transferred or returned)
    require!(
        ctx.accounts.escrow_nft_token_account.amount == 0,
        OutcryError::EscrowNotEmpty
    );

    // Drain remaining vault lamports (unclaimed deposits) to seller.
    // Unlike close_auction, we skip the "vault must be empty" check.
    let vault_info = ctx.accounts.auction_vault.to_account_info();
    let vault_lamports = vault_info.lamports();
    let rent = Rent::get()?;
    let vault_rent = rent.minimum_balance(vault_info.data_len());

    if vault_lamports > vault_rent {
        let drain_amount = vault_lamports - vault_rent;
        // Transfer via direct lamport manipulation (vault is a PDA we own)
        **vault_info.try_borrow_mut_lamports()? -= drain_amount;
        **ctx.accounts.seller.to_account_info().try_borrow_mut_lamports()? += drain_amount;
    }

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

    Ok(())
}
