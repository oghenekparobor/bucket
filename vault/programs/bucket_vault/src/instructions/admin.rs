use anchor_lang::prelude::*;
use anchor_spl::token::Mint as SplMint;
use anchor_spl::token_interface::Mint;

use crate::errors::VaultError;
use crate::events::*;
use crate::math;
use crate::program::BucketVault;
use crate::state::*;

pub fn validate_params(p: &ConfigParams) -> Result<()> {
    let whole = |bps: u16| bps % 100 == 0;
    require!(p.commission_bps <= 5_000, VaultError::InvalidParam);
    require!(p.platform_share_bps as u64 <= BPS, VaultError::InvalidParam);
    require!(p.mint_fee_bps <= 500 && p.redeem_fee_bps <= 500, VaultError::InvalidParam);
    require!(p.min_holdings >= 1 && p.min_holdings <= p.max_holdings, VaultError::InvalidParam);
    require!(p.max_holdings as usize <= MAX_HOLDINGS, VaultError::InvalidParam);
    require!(p.min_weight_bps >= 100 && whole(p.min_weight_bps), VaultError::InvalidParam);
    require!(
        p.max_weight_public_bps as u64 <= BPS
            && p.max_weight_pre_ipo_bps as u64 <= BPS
            && whole(p.max_weight_public_bps)
            && whole(p.max_weight_pre_ipo_bps)
            && p.min_weight_bps <= p.max_weight_pre_ipo_bps
            && p.min_weight_bps <= p.max_weight_public_bps,
        VaultError::InvalidParam
    );
    require!(p.max_active_buckets >= 1, VaultError::InvalidParam);
    require!(p.max_slippage_bps <= 1_000, VaultError::InvalidParam);
    require!(p.order_ttl_secs > 0 && p.max_price_age_secs > 0 && p.twap_window_secs > 0, VaultError::InvalidParam);
    require!(p.edit_delay_secs >= 0 && p.edit_cooldown_secs >= 0, VaultError::InvalidParam);
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct Roles {
    pub admin: Pubkey,
    pub keeper: Pubkey,
    pub price_authority: Pubkey,
    pub fee_wallet: Pubkey,
    pub swap_programs: [Pubkey; MAX_SWAP_PROGRAMS],
}

fn emit_config(config: &Config) -> Result<()> {
    emit!(ConfigUpdated {
        admin: config.admin,
        keeper: config.keeper,
        price_authority: config.price_authority,
        fee_wallet: config.fee_wallet,
        params: config.params,
        swap_programs: config.swap_programs,
        ts: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Box<Account<'info, Config>>,
    pub usdc_mint: Account<'info, SplMint>,
    /// Only the program's upgrade authority can create the config.
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ VaultError::Unauthorized)]
    pub program: Program<'info, BucketVault>,
    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()) @ VaultError::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_config(ctx: Context<InitializeConfig>, params: ConfigParams, roles: Roles) -> Result<()> {
    validate_params(&params)?;
    let config = &mut ctx.accounts.config;
    config.admin = roles.admin;
    config.keeper = roles.keeper;
    config.price_authority = roles.price_authority;
    config.fee_wallet = roles.fee_wallet;
    config.swap_programs = roles.swap_programs;
    config.usdc_mint = ctx.accounts.usdc_mint.key();
    config.params = params;
    config.bump = ctx.bumps.config;
    emit_config(config)
}

#[derive(Accounts)]
pub struct AdminConfig<'info> {
    #[account(address = config.admin @ VaultError::Unauthorized)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
}

pub fn update_config(ctx: Context<AdminConfig>, params: ConfigParams) -> Result<()> {
    validate_params(&params)?;
    ctx.accounts.config.params = params;
    emit_config(&ctx.accounts.config)
}

/// Rotates roles. Moving `admin` to a multisig is how phase 2 hands over control.
pub fn set_roles(ctx: Context<AdminConfig>, roles: Roles) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = roles.admin;
    config.keeper = roles.keeper;
    config.price_authority = roles.price_authority;
    config.fee_wallet = roles.fee_wallet;
    config.swap_programs = roles.swap_programs;
    emit_config(config)
}

#[derive(Accounts)]
pub struct AddAsset<'info> {
    #[account(mut, address = config.admin @ VaultError::Unauthorized)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init, payer = admin, space = 8 + Asset::INIT_SPACE,
        seeds = [ASSET_SEED, mint.key().as_ref()], bump
    )]
    pub asset: Account<'info, Asset>,
    pub system_program: Program<'info, System>,
}

pub fn add_asset(
    ctx: Context<AddAsset>,
    source: AssetSource,
    asset_type: AssetType,
    symbol: String,
    extra_cost_bps: u16,
    price_e6: u64,
) -> Result<()> {
    require!(symbol.len() <= MAX_SYMBOL_LEN, VaultError::InvalidParam);
    require!(extra_cost_bps <= 500 && price_e6 > 0, VaultError::InvalidParam);
    let now = Clock::get()?.unix_timestamp;
    let mint = &ctx.accounts.mint;
    let asset = &mut ctx.accounts.asset;
    asset.mint = mint.key();
    asset.token_program = *mint.to_account_info().owner;
    asset.decimals = mint.decimals;
    asset.source = source;
    asset.asset_type = asset_type;
    asset.enabled = true;
    asset.flagged = false;
    asset.extra_cost_bps = extra_cost_bps;
    asset.price_e6 = price_e6;
    asset.twap_e6 = price_e6;
    asset.last_price_ts = now;
    asset.symbol = symbol.clone();
    asset.bump = ctx.bumps.asset;
    emit!(AssetAdded {
        mint: asset.mint,
        token_program: asset.token_program,
        decimals: asset.decimals,
        source,
        asset_type,
        symbol,
        price_e6,
        ts: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SetAssetStatus<'info> {
    #[account(address = config.admin @ VaultError::Unauthorized)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [ASSET_SEED, asset.mint.as_ref()], bump = asset.bump)]
    pub asset: Account<'info, Asset>,
}

pub fn set_asset_status(ctx: Context<SetAssetStatus>, enabled: bool, flagged: bool, extra_cost_bps: u16) -> Result<()> {
    require!(extra_cost_bps <= 500, VaultError::InvalidParam);
    let asset = &mut ctx.accounts.asset;
    asset.enabled = enabled;
    asset.flagged = flagged;
    asset.extra_cost_bps = extra_cost_bps;
    emit!(AssetUpdated {
        mint: asset.mint,
        enabled,
        flagged,
        extra_cost_bps,
        ts: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct UpdatePrice<'info> {
    pub signer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [ASSET_SEED, asset.mint.as_ref()], bump = asset.bump)]
    pub asset: Account<'info, Asset>,
}

/// Price service push. The price is clamped to `max_price_move_bps` around
/// the TWAP, so one bad or manipulated print cannot move valuation far.
pub fn update_price(ctx: Context<UpdatePrice>, price_e6: u64) -> Result<()> {
    let config = &ctx.accounts.config;
    require_keys_eq!(ctx.accounts.signer.key(), config.price_authority, VaultError::Unauthorized);
    require!(price_e6 > 0, VaultError::InvalidParam);
    let now = Clock::get()?.unix_timestamp;
    let asset = &mut ctx.accounts.asset;
    let (price, clamped) = math::clamp_price(price_e6, asset.twap_e6, config.params.max_price_move_bps);
    asset.twap_e6 = math::twap_update(asset.twap_e6, price, now - asset.last_price_ts, config.params.twap_window_secs);
    asset.price_e6 = price;
    asset.last_price_ts = now;
    emit!(PriceUpdated { mint: asset.mint, price_e6: price, twap_e6: asset.twap_e6, clamped, forced: false, ts: now });
    Ok(())
}

/// Admin override for corporate actions and relistings: sets price and TWAP.
pub fn force_price(ctx: Context<UpdatePrice>, price_e6: u64) -> Result<()> {
    require_keys_eq!(ctx.accounts.signer.key(), ctx.accounts.config.admin, VaultError::Unauthorized);
    require!(price_e6 > 0, VaultError::InvalidParam);
    let now = Clock::get()?.unix_timestamp;
    let asset = &mut ctx.accounts.asset;
    asset.price_e6 = price_e6;
    asset.twap_e6 = price_e6;
    asset.last_price_ts = now;
    emit!(PriceUpdated { mint: asset.mint, price_e6, twap_e6: price_e6, clamped: false, forced: true, ts: now });
    Ok(())
}
