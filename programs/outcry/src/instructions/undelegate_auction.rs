use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::commit;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;

use crate::errors::OutcryError;
use crate::state::{AuctionState, AuctionStatus};

/// Commits the AuctionState and undelegates it back to L1.
/// Called after end_auction sets status to Ended. Sends to ER endpoint.
///
/// After undelegation, the committed state is available on L1 for
/// settle_auction and claim_refund.
#[commit]
#[derive(Accounts)]
pub struct UndelegateAuction<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        constraint = auction_state.status == AuctionStatus::Ended @ OutcryError::InvalidAuctionStatus,
        constraint = auction_state.seller == payer.key() @ OutcryError::UnauthorizedSeller,
    )]
    pub auction_state: Account<'info, AuctionState>,
}

pub fn handle_undelegate_auction(ctx: Context<UndelegateAuction>) -> Result<()> {
    commit_and_undelegate_accounts(
        &ctx.accounts.payer,
        vec![&ctx.accounts.auction_state.to_account_info()],
        &ctx.accounts.magic_context,
        &ctx.accounts.magic_program,
    )?;

    Ok(())
}
