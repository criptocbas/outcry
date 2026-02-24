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

/// Metaplex Token Metadata program ID (for cross-program PDA validation)
pub mod token_metadata_program {
    anchor_lang::declare_id!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
}

/// Parsed creator from Metaplex metadata
struct MetaplexCreator {
    address: Pubkey,
    share: u8,
}

/// Parse seller_fee_basis_points and creators from raw Metaplex metadata account data.
///
/// Binary layout (Borsh-serialized):
///   key(1) + update_authority(32) + mint(32) = 65 bytes header
///   name: String(4-byte len + bytes)
///   symbol: String(4-byte len + bytes)
///   uri: String(4-byte len + bytes)
///   seller_fee_basis_points: u16
///   creators: Option<Vec<Creator>>
///     Creator = address(32) + verified(1) + share(1)
fn parse_metadata_royalties(data: &[u8]) -> Result<(u16, Vec<MetaplexCreator>)> {
    let mut offset: usize = 65; // skip key + update_authority + mint

    // Skip 3 Borsh strings: name, symbol, uri
    for _ in 0..3 {
        require!(offset + 4 <= data.len(), OutcryError::InvalidMetadata);
        let len = u32::from_le_bytes(
            data[offset..offset + 4]
                .try_into()
                .map_err(|_| error!(OutcryError::InvalidMetadata))?,
        ) as usize;
        // Bounds check: ensure offset + 4 + len doesn't overflow or exceed data
        let new_offset = offset
            .checked_add(4)
            .and_then(|o| o.checked_add(len))
            .ok_or(error!(OutcryError::InvalidMetadata))?;
        require!(new_offset <= data.len(), OutcryError::InvalidMetadata);
        offset = new_offset;
    }

    // Read seller_fee_basis_points (u16, little-endian)
    require!(offset + 2 <= data.len(), OutcryError::InvalidMetadata);
    let seller_fee_bps = u16::from_le_bytes(
        data[offset..offset + 2]
            .try_into()
            .map_err(|_| error!(OutcryError::InvalidMetadata))?,
    );
    offset += 2;

    // Read Option<Vec<Creator>>
    require!(offset + 1 <= data.len(), OutcryError::InvalidMetadata);
    let has_creators = data[offset] == 1;
    offset += 1;

    let mut creators = Vec::new();
    if has_creators {
        require!(offset + 4 <= data.len(), OutcryError::InvalidMetadata);
        let count = u32::from_le_bytes(
            data[offset..offset + 4]
                .try_into()
                .map_err(|_| error!(OutcryError::InvalidMetadata))?,
        ) as usize;
        offset += 4;

        for _ in 0..count {
            require!(offset + 34 <= data.len(), OutcryError::InvalidMetadata);
            let address = Pubkey::try_from(&data[offset..offset + 32])
                .map_err(|_| error!(OutcryError::InvalidMetadata))?;
            // Skip verified flag (offset + 32) — we pay all listed creators
            let share = data[offset + 33];
            offset += 34;

            if share > 0 {
                creators.push(MetaplexCreator { address, share });
            }
        }
    }

    Ok((seller_fee_bps, creators))
}

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

    /// CHECK: Metaplex Token Metadata PDA — validated via cross-program seeds derivation.
    /// Parsed for seller_fee_basis_points and creators to enforce royalty distribution.
    #[account(
        seeds = [
            b"metadata",
            token_metadata_program::ID.as_ref(),
            nft_mint.key().as_ref(),
        ],
        bump,
        seeds::program = token_metadata_program::ID,
    )]
    pub nft_metadata: UncheckedAccount<'info>,

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

    // ATOMIC: Set Settled immediately to prevent double-settle attacks.
    // If anything below fails, the auction is still Settled — but that's safer
    // than allowing two concurrent settlements to both transfer funds.
    auction.status = AuctionStatus::Settled;

    let winning_bid = auction.current_bid;
    let winner_key = auction.highest_bidder;

    // Deduct winning bid from winner's deposit
    let winner_deposit = &mut ctx.accounts.winner_deposit;
    winner_deposit.amount = winner_deposit
        .amount
        .checked_sub(winning_bid)
        .ok_or(OutcryError::ArithmeticOverflow)?;

    // --- Parse royalty info from Metaplex metadata ---
    let metadata_data = ctx.accounts.nft_metadata.try_borrow_data()?;
    let (seller_fee_bps, creators) = parse_metadata_royalties(&metadata_data)?;
    drop(metadata_data); // Release borrow before lamport transfers

    // Calculate total royalties
    let total_royalties = (winning_bid as u128)
        .checked_mul(seller_fee_bps as u128)
        .ok_or(OutcryError::ArithmeticOverflow)?
        .checked_div(10_000)
        .ok_or(OutcryError::ArithmeticOverflow)? as u64;

    // --- Distribute royalties to creators via remaining_accounts ---
    let mut distributed_royalties: u64 = 0;

    if total_royalties > 0 && !creators.is_empty() {
        require!(
            ctx.remaining_accounts.len() >= creators.len(),
            OutcryError::MissingCreatorAccount
        );

        let vault_info = ctx.accounts.auction_vault.to_account_info();

        for (i, creator) in creators.iter().enumerate() {
            let creator_account = &ctx.remaining_accounts[i];
            require!(
                creator_account.key() == creator.address,
                OutcryError::MissingCreatorAccount
            );

            let creator_royalty = (total_royalties as u128)
                .checked_mul(creator.share as u128)
                .ok_or(OutcryError::ArithmeticOverflow)?
                .checked_div(100)
                .ok_or(OutcryError::ArithmeticOverflow)? as u64;

            if creator_royalty > 0 {
                **vault_info.try_borrow_mut_lamports()? -= creator_royalty;
                **creator_account.try_borrow_mut_lamports()? += creator_royalty;
                distributed_royalties += creator_royalty;
            }
        }
    }

    // --- Send remainder to seller (winning bid minus royalties) ---
    let seller_receives = winning_bid
        .checked_sub(distributed_royalties)
        .ok_or(OutcryError::ArithmeticOverflow)?;

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

    emit!(AuctionSettled {
        auction: ctx.accounts.auction_state.key(),
        winner: winner_key,
        final_price: winning_bid,
        seller_received: seller_receives,
        royalties_paid: distributed_royalties,
    });

    Ok(())
}
