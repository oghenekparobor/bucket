//! Every state change emits one of these. The indexer rebuilds all vault state
//! and unit price history from them plus `PriceUpdated`, so events that move a
//! vault balance carry the post-change balance and events that move supply
//! carry the post-change supply.

use anchor_lang::prelude::*;

use crate::state::{AssetSource, AssetType, ConfigParams};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct WeightEntry {
    pub mint: Pubkey,
    pub weight_bps: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct AmountEntry {
    pub mint: Pubkey,
    pub amount: u64,
}

#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub keeper: Pubkey,
    pub price_authority: Pubkey,
    pub fee_wallet: Pubkey,
    pub params: ConfigParams,
    pub swap_programs: [Pubkey; 4],
    pub ts: i64,
}

#[event]
pub struct AssetAdded {
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub decimals: u8,
    pub source: AssetSource,
    pub asset_type: AssetType,
    pub symbol: String,
    pub price_e6: u64,
    pub ts: i64,
}

#[event]
pub struct AssetUpdated {
    pub mint: Pubkey,
    pub enabled: bool,
    pub flagged: bool,
    pub extra_cost_bps: u16,
    pub ts: i64,
}

#[event]
pub struct PriceUpdated {
    pub mint: Pubkey,
    pub price_e6: u64,
    pub twap_e6: u64,
    /// True when the pushed price was clamped to the move bound.
    pub clamped: bool,
    pub forced: bool,
    pub ts: i64,
}

#[event]
pub struct BucketCreated {
    pub bucket: Pubkey,
    pub creator: Pubkey,
    pub id: u32,
    pub token_mint: Pubkey,
    pub name: String,
    pub thesis: String,
    pub holdings: Vec<WeightEntry>,
    pub ts: i64,
}

#[event]
pub struct BucketInfoUpdated {
    pub bucket: Pubkey,
    pub name: String,
    pub thesis: String,
    pub ts: i64,
}

#[event]
pub struct MintOpened {
    pub order: Pubkey,
    pub bucket: Pubkey,
    pub backer: Pubkey,
    pub amount_e6: u64,
    pub fee_e6: u64,
    pub net_e6: u64,
    /// USDC recovered for a sponsored token-account rent (0 if none).
    pub rent_fee_e6: u64,
    pub unit_price_e6: u64,
    pub legs: Vec<AmountEntry>,
    pub ts: i64,
}

#[event]
pub struct MintFilled {
    pub order: Pubkey,
    pub bucket: Pubkey,
    pub backer: Pubkey,
    pub leg: u8,
    pub mint: Pubkey,
    pub usdc_spent: u64,
    pub qty: u64,
    pub tokens: u64,
    pub vault_balance: u64,
    pub supply: u64,
    pub ts: i64,
}

#[event]
pub struct MintClosed {
    pub order: Pubkey,
    pub bucket: Pubkey,
    pub backer: Pubkey,
    pub refunded_e6: u64,
    pub tokens_total: u64,
    pub ts: i64,
}

#[event]
pub struct Redeemed {
    pub order: Pubkey,
    pub bucket: Pubkey,
    pub holder: Pubkey,
    pub tokens_burned: u64,
    pub fee_tokens: u64,
    pub unit_price_e6: u64,
    pub legs: Vec<AmountEntry>,
    pub supply: u64,
    /// False when prices were stale and commission settlement was skipped.
    pub settled: bool,
    pub ts: i64,
}

#[event]
pub struct RedeemFilled {
    pub order: Pubkey,
    pub bucket: Pubkey,
    pub holder: Pubkey,
    pub leg: u8,
    pub mint: Pubkey,
    pub qty_sold: u64,
    pub usdc_out: u64,
    pub vault_balance: u64,
    pub ts: i64,
}

#[event]
pub struct RedeemClaimed {
    pub order: Pubkey,
    pub bucket: Pubkey,
    pub holder: Pubkey,
    pub leg: u8,
    pub mint: Pubkey,
    pub qty: u64,
    pub vault_balance: u64,
    pub ts: i64,
}

#[event]
pub struct RedeemClosed {
    pub order: Pubkey,
    pub bucket: Pubkey,
    pub holder: Pubkey,
    pub usdc_out_total: u64,
    pub ts: i64,
}

#[event]
pub struct CommissionSettled {
    pub bucket: Pubkey,
    pub vault_value_e6: u64,
    pub supply_before: u64,
    pub unit_price_before_e6: u64,
    pub hwm_before_e6: u64,
    pub commission_e6: u64,
    pub creator_tokens: u64,
    pub platform_tokens: u64,
    pub hwm_after_e6: u64,
    pub ts: i64,
}

#[event]
pub struct FeesClaimed {
    pub bucket: Pubkey,
    pub recipient: Pubkey,
    pub creator: bool,
    pub tokens: u64,
    pub ts: i64,
}

#[event]
pub struct BucketClosed {
    pub bucket: Pubkey,
    pub creator: Pubkey,
    pub ts: i64,
}

#[event]
pub struct EditProposed {
    pub bucket: Pubkey,
    pub version: u16,
    pub holdings: Vec<WeightEntry>,
    pub note: String,
    pub effective_at: i64,
    pub forced: bool,
    pub ts: i64,
}

#[event]
pub struct EditActivated {
    pub bucket: Pubkey,
    pub version: u16,
    pub holdings: Vec<WeightEntry>,
    pub ts: i64,
}

#[event]
pub struct Rebalanced {
    pub bucket: Pubkey,
    pub from_mint: Pubkey,
    pub to_mint: Pubkey,
    pub qty_in: u64,
    pub qty_out: u64,
    pub from_balance: u64,
    pub to_balance: u64,
    pub ts: i64,
}
