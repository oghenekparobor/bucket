use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("Signer is not allowed to do this")]
    Unauthorized,
    #[msg("Invalid config parameter")]
    InvalidParam,
    #[msg("A bucket needs between 2 and 15 holdings")]
    HoldingCount,
    #[msg("A token appears twice in the recipe")]
    DuplicateHolding,
    #[msg("Weights must be whole percentages")]
    WeightNotWholePercent,
    #[msg("Weight below the minimum")]
    WeightTooLow,
    #[msg("Weight above the cap for this asset type")]
    WeightTooHigh,
    #[msg("Weights must sum to 100%")]
    WeightSum,
    #[msg("Token is not in the allowed catalog")]
    AssetNotAllowed,
    #[msg("Name must be 1 to 48 bytes")]
    NameLength,
    #[msg("Thesis is longer than 280 bytes")]
    ThesisLength,
    #[msg("Note is longer than 140 bytes")]
    NoteLength,
    #[msg("This wallet already has the maximum number of active buckets")]
    TooManyBuckets,
    #[msg("The bucket is closed to new money")]
    BucketClosed,
    #[msg("New mints are paused")]
    MintsPaused,
    #[msg("The creator must fund the bucket first")]
    CreatorNotFunded,
    #[msg("Amount below the minimum")]
    BelowMinimum,
    #[msg("This mint would take the vault over its cap")]
    VaultCap,
    #[msg("Account list does not match the bucket's holdings")]
    HoldingAccounts,
    #[msg("A holding price is missing or stale")]
    StalePrice,
    #[msg("Vault value is zero")]
    ZeroVaultValue,
    #[msg("Swap program is not allowed")]
    SwapProgramNotAllowed,
    #[msg("Swap touched an account it must not touch")]
    ForbiddenSwapAccount,
    #[msg("Swap spent more than allowed")]
    OverSpent,
    #[msg("Swap output below minimum")]
    OutputTooLow,
    #[msg("Swap exceeded the slippage bound")]
    SlippageExceeded,
    #[msg("Vault account authority changed during swap")]
    AuthorityChanged,
    #[msg("Order has expired")]
    OrderExpired,
    #[msg("Order is not finished")]
    OrderNotFinished,
    #[msg("Leg is already complete")]
    LegDone,
    #[msg("Leg index out of range")]
    LegIndex,
    #[msg("Amount exceeds what is left on this leg")]
    LegOverflow,
    #[msg("Nothing to redeem")]
    ZeroAmount,
    #[msg("An edit is already pending")]
    EditPending,
    #[msg("No edit is pending")]
    NoPendingEdit,
    #[msg("Edits are limited to one per cooldown period")]
    EditCooldown,
    #[msg("Pending edit is not effective yet")]
    EditNotEffective,
    #[msg("Too many holdings entries; finish the previous rebalance first")]
    TooManyEntries,
    #[msg("Rebalance must move value from an over-weight to an under-weight holding")]
    RebalanceDirection,
    #[msg("Vault valuation is too old; settle first")]
    StaleValuation,
    #[msg("Vault token account is missing or wrong")]
    VaultAccount,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Metadata URI is empty or longer than 200 characters")]
    UriLength,
}
