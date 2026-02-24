use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::{
    constants::*,
    errors::OutcryError,
    events::DepositMade,
    state::{AuctionState, AuctionStatus, AuctionVault, BidderDeposit},
};

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,

    /// The auction this deposit is for. We accept any account here because when
    /// the AuctionState is delegated to ER, its L1 owner changes to the
    /// delegation program and Anchor's Account<> deserialization would fail.
    /// Security: the auction_vault PDA is derived from this key — if a fake
    /// address is passed, the vault constraint fails.
    /// CHECK: Implicitly validated via auction_vault seeds constraint.
    pub auction_state: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = bidder,
        space = 8 + BidderDeposit::INIT_SPACE,
        seeds = [DEPOSIT_SEED, auction_state.key().as_ref(), bidder.key().as_ref()],
        bump,
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

pub fn handle_deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, OutcryError::InvalidDepositAmount);

    // Reject deposits after auction has ended/settled/cancelled.
    // When auction is delegated to ER, its owner changes to the delegation program
    // and we can't deserialize — but that means it's Active, so deposits are valid.
    let auction_info = &ctx.accounts.auction_state;
    if auction_info.owner == &crate::ID {
        let data = auction_info.try_borrow_data()?;
        if data.len() >= 8 + AuctionState::SPACE - 8 {
            let mut slice: &[u8] = &data;
            if let Ok(auction) = AuctionState::try_deserialize(&mut slice) {
                require!(
                    auction.status == AuctionStatus::Created
                        || auction.status == AuctionStatus::Active,
                    OutcryError::InvalidAuctionStatus
                );
            }
        }
        drop(data);
    }

    let deposit = &mut ctx.accounts.bidder_deposit;
    let auction_key = ctx.accounts.auction_state.key();
    let bidder_key = ctx.accounts.bidder.key();

    // Initialize fields if this is a new deposit account
    if deposit.auction == Pubkey::default() {
        deposit.auction = auction_key;
        deposit.bidder = bidder_key;
        deposit.bump = ctx.bumps.bidder_deposit;
    }

    // Update deposit amount
    deposit.amount = deposit
        .amount
        .checked_add(amount)
        .ok_or(OutcryError::ArithmeticOverflow)?;

    // Transfer SOL from bidder to vault
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.bidder.to_account_info(),
                to: ctx.accounts.auction_vault.to_account_info(),
            },
        ),
        amount,
    )?;

    emit!(DepositMade {
        auction: auction_key,
        bidder: bidder_key,
        amount,
        total_deposit: deposit.amount,
    });

    Ok(())
}
