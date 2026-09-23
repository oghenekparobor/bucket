use anchor_lang::prelude::*;

pub const CONFIG_SEED: &[u8] = b"config";
pub const ASSET_SEED: &[u8] = b"asset";
pub const CREATOR_SEED: &[u8] = b"creator";
pub const BUCKET_SEED: &[u8] = b"bucket";
pub const BUCKET_MINT_SEED: &[u8] = b"bucket_mint";
pub const CREATOR_FEE_SEED: &[u8] = b"creator_fee";
pub const PLATFORM_FEE_SEED: &[u8] = b"platform_fee";
pub const MINT_ORDER_SEED: &[u8] = b"mint_order";
pub const REDEEM_ORDER_SEED: &[u8] = b"redeem_order";

/// Bucket tokens have 6 decimals, like USDC.
pub const BUCKET_DECIMALS: u8 = 6;
pub const ONE_TOKEN: u64 = 1_000_000;
/// Unit price every bucket starts at: $100.
pub const INITIAL_UNIT_PRICE_E6: u64 = 100_000_000;
pub const BPS: u64 = 10_000;

pub const MAX_HOLDINGS: usize = 15;
/// Active holdings plus holdings an edit removed that the keeper is still selling
/// down: room for a full 15-for-15 replacement.
pub const MAX_ENTRIES: usize = 30;
pub const MAX_SWAP_PROGRAMS: usize = 4;
pub const MAX_NAME_LEN: usize = 48;
pub const MAX_THESIS_LEN: usize = 280;
pub const MAX_NOTE_LEN: usize = 140;
pub const MAX_SYMBOL_LEN: usize = 16;
/// Most a sponsor may recover in USDC for fronting a new holder's token account rent ($1).
pub const MAX_RENT_FEE_E6: u64 = 1_000_000;
/// Supply this small (0.001 token) over an empty vault is rounding dust: the
/// next mint starts the bucket again at its high-water mark.
pub const DUST_SUPPLY: u64 = 1_000;
/// A mint leg with less than one cent of budget left is treated as filled.
pub const LEG_DUST_E6: u64 = 10_000;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum AssetSource {
    XStocks,
    PreStocks,
    Tessera,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum AssetType {
    PublicStock,
    Etf,
    PreIpo,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum BucketStatus {
    Open,
    Closed,
}

/// Every tunable the product might revisit. See docs/architecture.md §2.1.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace)]
pub struct ConfigParams {
    pub commission_bps: u16,
    pub platform_share_bps: u16,
    pub mint_fee_bps: u16,
    pub redeem_fee_bps: u16,
    pub min_creator_deposit_e6: u64,
    pub min_deposit_e6: u64,
    pub min_holdings: u8,
    pub max_holdings: u8,
    pub min_weight_bps: u16,
    pub max_weight_public_bps: u16,
    pub max_weight_pre_ipo_bps: u16,
    pub max_active_buckets: u8,
    pub max_slippage_bps: u16,
    /// Largest vault value a bucket may reach through mints. 0 = no cap.
    pub vault_cap_e6: u64,
    pub order_ttl_secs: i64,
    pub max_price_age_secs: i64,
    /// A pushed price is clamped to within this distance of the TWAP.
    pub max_price_move_bps: u16,
    pub twap_window_secs: i64,
    pub edit_delay_secs: i64,
    pub edit_cooldown_secs: i64,
    pub mints_paused: bool,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub keeper: Pubkey,
    pub price_authority: Pubkey,
    /// Platform wallet: receives the USDC mint fee and owns claimed platform commission.
    pub fee_wallet: Pubkey,
    pub usdc_mint: Pubkey,
    pub params: ConfigParams,
    pub swap_programs: [Pubkey; MAX_SWAP_PROGRAMS],
    pub bump: u8,
}

impl Config {
    pub fn is_swap_program(&self, key: &Pubkey) -> bool {
        *key != Pubkey::default() && self.swap_programs.contains(key)
    }
}

/// One allowed mint: catalog metadata plus its on-chain price feed.
#[account]
#[derive(InitSpace)]
pub struct Asset {
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub decimals: u8,
    pub source: AssetSource,
    pub asset_type: AssetType,
    /// False blocks new buckets and edits from adding it. Existing buckets keep it.
    pub enabled: bool,
    /// Set when the token disappears from its issuer feed and needs review.
    pub flagged: bool,
    /// Extra cost allowed on top of the slippage bound, e.g. an issuer transfer fee.
    pub extra_cost_bps: u16,
    /// Micro-dollars per whole raw token (before any scaled-UI multiplier).
    pub price_e6: u64,
    pub twap_e6: u64,
    pub last_price_ts: i64,
    #[max_len(MAX_SYMBOL_LEN)]
    pub symbol: String,
    pub bump: u8,
}

impl Asset {
    pub fn max_weight_bps(&self, p: &ConfigParams) -> u16 {
        match self.asset_type {
            AssetType::PreIpo => p.max_weight_pre_ipo_bps,
            _ => p.max_weight_public_bps,
        }
    }
    pub fn is_fresh(&self, now: i64, p: &ConfigParams) -> bool {
        self.price_e6 > 0 && now.saturating_sub(self.last_price_ts) <= p.max_price_age_secs
    }
    /// Price used to value the vault for commission: never above the TWAP, so a
    /// short spike cannot mint fee tokens.
    pub fn conservative_price_e6(&self) -> u64 {
        if self.twap_e6 == 0 {
            self.price_e6
        } else {
            self.price_e6.min(self.twap_e6)
        }
    }
}

#[account]
#[derive(InitSpace)]
pub struct CreatorState {
    pub creator: Pubkey,
    pub next_bucket_id: u32,
    pub active_buckets: u8,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace, PartialEq, Eq)]
pub struct Holding {
    pub mint: Pubkey,
    /// Canonical vault ATA (owner = bucket PDA), fixed when the holding is added.
    pub vault: Pubkey,
    pub decimals: u8,
    /// 0 for a holding an edit removed that still has a balance to sell down.
    pub weight_bps: u16,
    /// Quantity owed to open redeem orders. Never counted in vault value.
    pub reserved: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace, PartialEq, Eq)]
pub struct PendingHolding {
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub decimals: u8,
    pub weight_bps: u16,
}

#[account]
#[derive(InitSpace)]
pub struct Bucket {
    pub creator: Pubkey,
    pub id: u32,
    pub status: BucketStatus,
    pub token_mint: Pubkey,
    pub hwm_e6: u64,
    pub version: u16,
    #[max_len(MAX_ENTRIES)]
    pub holdings: Vec<Holding>,
    #[max_len(MAX_NAME_LEN)]
    pub name: String,
    #[max_len(MAX_THESIS_LEN)]
    pub thesis: String,
    pub created_at: i64,
    /// Set by the creator's first mint. Nobody else can mint before it.
    pub creator_funded: bool,
    pub last_settled_at: i64,
    /// Vault value (spot) and time at the last settlement; bounds rebalances.
    pub last_value_e6: u64,
    pub last_valued_at: i64,
    pub last_edit_proposed_at: i64,
    #[max_len(MAX_HOLDINGS)]
    pub pending: Vec<PendingHolding>,
    pub pending_effective_at: i64,
    #[max_len(MAX_NOTE_LEN)]
    pub pending_note: String,
    pub bump: u8,
    pub mint_bump: u8,
}

impl Bucket {
    pub fn has_pending(&self) -> bool {
        !self.pending.is_empty()
    }
    pub fn find(&self, mint: &Pubkey) -> Option<usize> {
        self.holdings.iter().position(|h| h.mint == *mint)
    }
}

/// Signer seeds for a bucket PDA. `$id` must be a `[u8; 4]` binding that outlives the call.
#[macro_export]
macro_rules! bucket_seeds {
    ($bucket:expr, $id:ident) => {
        &[
            $crate::state::BUCKET_SEED,
            $bucket.creator.as_ref(),
            &$id,
            &[$bucket.bump],
        ]
    };
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace)]
pub struct MintLeg {
    pub mint: Pubkey,
    pub budget_e6: u64,
    pub spent_e6: u64,
    /// Reference price captured when the order opened.
    pub price_e6: u64,
    pub qty: u64,
    pub tokens: u64,
    pub done: bool,
}

#[account]
#[derive(InitSpace)]
pub struct MintOrder {
    pub bucket: Pubkey,
    pub backer: Pubkey,
    pub rent_payer: Pubkey,
    pub nonce: u64,
    pub created_at: i64,
    pub expires_at: i64,
    pub unit_price_e6: u64,
    pub usdc_total_e6: u64,
    pub tokens_issued: u64,
    #[max_len(MAX_ENTRIES)]
    pub legs: Vec<MintLeg>,
    pub bump: u8,
}

impl MintOrder {
    pub fn all_done(&self) -> bool {
        self.legs.iter().all(|l| l.done)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace)]
pub struct RedeemLeg {
    pub mint: Pubkey,
    pub qty: u64,
    pub sold: u64,
    pub usdc_out: u64,
    pub claimed: u64,
    pub done: bool,
}

impl RedeemLeg {
    pub fn remaining(&self) -> u64 {
        self.qty - self.sold - self.claimed
    }
}

#[account]
#[derive(InitSpace)]
pub struct RedeemOrder {
    pub bucket: Pubkey,
    pub holder: Pubkey,
    pub rent_payer: Pubkey,
    pub nonce: u64,
    pub created_at: i64,
    pub unit_price_e6: u64,
    pub tokens_burned: u64,
    #[max_len(MAX_ENTRIES)]
    pub legs: Vec<RedeemLeg>,
    pub bump: u8,
}

impl RedeemOrder {
    pub fn all_done(&self) -> bool {
        self.legs.iter().all(|l| l.done)
    }
}
