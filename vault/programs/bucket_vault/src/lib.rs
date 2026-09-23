//! Bucket vault program.
//!
//! A bucket is a public, weighted recipe of tokenized stocks with its own
//! fully backed token. Money in buys every holding into a program-owned vault
//! and mints bucket tokens; bucket tokens out burn and pay the holder their
//! pro-rata slice. The creator steers weights (with 24h notice) and earns 20%
//! of unit-price growth above its high-water mark, paid in newly minted tokens.
//! Nobody — creator, keeper or admin — has an instruction that moves vault
//! assets anywhere except back into the vault or to the redeeming holder.
//!
//! See docs/architecture.md for the account and instruction contract.

use anchor_lang::prelude::*;

#[macro_use]
pub mod state;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod vault;

use instructions::*;
use state::*;

declare_id!("GwTYDwQh9nCACjBD44EK5qm5QmfWUw1XtF1RfyrigN29");

#[program]
pub mod bucket_vault {
    use super::*;

    // ---- admin ----

    pub fn initialize_config(ctx: Context<InitializeConfig>, params: ConfigParams, roles: Roles) -> Result<()> {
        admin::initialize_config(ctx, params, roles)
    }

    pub fn update_config(ctx: Context<AdminConfig>, params: ConfigParams) -> Result<()> {
        admin::update_config(ctx, params)
    }

    pub fn set_roles(ctx: Context<AdminConfig>, roles: Roles) -> Result<()> {
        admin::set_roles(ctx, roles)
    }

    pub fn add_asset(
        ctx: Context<AddAsset>,
        source: AssetSource,
        asset_type: AssetType,
        symbol: String,
        extra_cost_bps: u16,
        price_e6: u64,
    ) -> Result<()> {
        admin::add_asset(ctx, source, asset_type, symbol, extra_cost_bps, price_e6)
    }

    pub fn set_asset_status(ctx: Context<SetAssetStatus>, enabled: bool, flagged: bool, extra_cost_bps: u16) -> Result<()> {
        admin::set_asset_status(ctx, enabled, flagged, extra_cost_bps)
    }

    pub fn update_price(ctx: Context<UpdatePrice>, price_e6: u64) -> Result<()> {
        admin::update_price(ctx, price_e6)
    }

    pub fn force_price(ctx: Context<UpdatePrice>, price_e6: u64) -> Result<()> {
        admin::force_price(ctx, price_e6)
    }

    // ---- bucket lifecycle ----

    pub fn create_bucket<'info>(
        ctx: Context<'_, '_, 'info, 'info, CreateBucket<'info>>,
        id: u32,
        name: String,
        thesis: String,
        weights_bps: Vec<u16>,
    ) -> Result<()> {
        lifecycle::create_bucket(ctx, id, name, thesis, weights_bps)
    }

    pub fn update_bucket_info(ctx: Context<UpdateBucketInfo>, name: String, thesis: String) -> Result<()> {
        lifecycle::update_bucket_info(ctx, name, thesis)
    }

    pub fn close_bucket(ctx: Context<CloseBucket>) -> Result<()> {
        lifecycle::close_bucket(ctx)
    }

    pub fn settle_commission<'info>(ctx: Context<'_, '_, 'info, 'info, SettleCommission<'info>>) -> Result<()> {
        lifecycle::settle_commission(ctx)
    }

    pub fn claim_fees(ctx: Context<ClaimFees>, creator: bool) -> Result<()> {
        lifecycle::claim_fees(ctx, creator)
    }

    // ---- money in ----

    pub fn open_mint<'info>(
        ctx: Context<'_, '_, 'info, 'info, OpenMint<'info>>,
        amount_e6: u64,
        nonce: u64,
        rent_fee_e6: u64,
    ) -> Result<()> {
        mint::open_mint(ctx, amount_e6, nonce, rent_fee_e6)
    }

    pub fn fill_mint<'info>(
        ctx: Context<'_, '_, 'info, 'info, FillMint<'info>>,
        leg: u8,
        usdc_in: u64,
        min_out: u64,
        swap_data: Vec<u8>,
    ) -> Result<()> {
        mint::fill_mint(ctx, leg, usdc_in, min_out, swap_data)
    }

    pub fn close_mint_order(ctx: Context<CloseMintOrder>) -> Result<()> {
        mint::close_mint_order(ctx)
    }

    // ---- money out ----

    pub fn redeem<'info>(ctx: Context<'_, '_, 'info, 'info, Redeem<'info>>, tokens: u64, nonce: u64) -> Result<()> {
        redeem::redeem(ctx, tokens, nonce)
    }

    pub fn fill_redeem<'info>(
        ctx: Context<'_, '_, 'info, 'info, FillRedeem<'info>>,
        leg: u8,
        qty: u64,
        min_usdc_out: u64,
        swap_data: Vec<u8>,
    ) -> Result<()> {
        redeem::fill_redeem(ctx, leg, qty, min_usdc_out, swap_data)
    }

    pub fn claim_redeem_in_kind(ctx: Context<ClaimRedeemInKind>, leg: u8) -> Result<()> {
        redeem::claim_redeem_in_kind(ctx, leg)
    }

    pub fn close_redeem_order(ctx: Context<CloseRedeemOrder>) -> Result<()> {
        redeem::close_redeem_order(ctx)
    }

    // ---- edits and rebalancing (phase 2) ----

    pub fn propose_edit<'info>(
        ctx: Context<'_, '_, 'info, 'info, ProposeEdit<'info>>,
        weights_bps: Vec<u16>,
        note: String,
    ) -> Result<()> {
        edit::propose_edit(ctx, weights_bps, note)
    }

    pub fn admin_propose_removal<'info>(ctx: Context<'_, '_, 'info, 'info, AdminProposeRemoval<'info>>, mint: Pubkey) -> Result<()> {
        edit::admin_propose_removal(ctx, mint)
    }

    pub fn activate_edit<'info>(ctx: Context<'_, '_, 'info, 'info, ActivateEdit<'info>>) -> Result<()> {
        edit::activate_edit(ctx)
    }

    pub fn rebalance<'info>(
        ctx: Context<'_, '_, 'info, 'info, Rebalance<'info>>,
        qty_in: u64,
        min_out: u64,
        swap_data: Vec<u8>,
    ) -> Result<()> {
        rebalance::rebalance(ctx, qty_in, min_out, swap_data)
    }
}
