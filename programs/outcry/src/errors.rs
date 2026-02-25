use anchor_lang::prelude::*;

#[error_code]
pub enum OutcryError {
    #[msg("Bid must exceed current bid plus minimum increment")]
    BidTooLow,
    #[msg("Auction has not started yet")]
    AuctionNotStarted,
    #[msg("Auction has already ended")]
    AuctionEnded,
    #[msg("Auction is not in the correct status for this operation")]
    InvalidAuctionStatus,
    #[msg("Only the seller can perform this action")]
    UnauthorizedSeller,
    #[msg("Bid does not meet reserve price")]
    BelowReserve,
    #[msg("Winner deposit insufficient for winning bid")]
    InsufficientDeposit,
    #[msg("Auction still has time remaining")]
    AuctionStillActive,
    #[msg("Cannot cancel auction with existing bids")]
    CannotCancelWithBids,
    #[msg("Nothing to refund")]
    NothingToRefund,
    #[msg("Refund only available after settlement or cancellation")]
    RefundNotAvailable,
    #[msg("Auction duration is out of valid range")]
    InvalidDuration,
    #[msg("Reserve price must be greater than zero")]
    InvalidReservePrice,
    #[msg("Deposit amount must be greater than zero")]
    InvalidDepositAmount,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Seller cannot bid on their own auction")]
    SellerCannotBid,
    #[msg("Cannot close auction with outstanding deposits — all bidders must claim refunds first")]
    OutstandingDeposits,
    #[msg("Cannot close auction while escrow still holds tokens")]
    EscrowNotEmpty,
    #[msg("NFT mint must have 0 decimals")]
    InvalidNftMint,
    #[msg("Could not parse Metaplex metadata account")]
    InvalidMetadata,
    #[msg("Missing creator account in remaining_accounts for royalty distribution")]
    MissingCreatorAccount,
    #[msg("Forfeit not needed — winner has sufficient deposit for the winning bid")]
    ForfeitNotNeeded,
    #[msg("Invalid protocol treasury account")]
    InvalidTreasury,
    #[msg("Auction has no bids to settle")]
    NoBidsToSettle,
    #[msg("Minimum bid increment must be greater than zero")]
    InvalidBidIncrement,
    #[msg("Could not deserialize deposit account data")]
    InvalidDepositAccount,
    #[msg("Vault has insufficient lamports for this operation")]
    InsufficientVaultBalance,
    #[msg("Grace period has not elapsed — bidders still have time to claim refunds")]
    GracePeriodNotElapsed,
}
