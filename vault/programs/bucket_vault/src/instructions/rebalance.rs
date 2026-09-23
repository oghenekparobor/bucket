use anchor_lang::prelude::*;

use crate::errors::VaultError;
use crate::events::*;
use crate::math;
use crate::state::*;
use crate::vault;

#[derive(Accounts)]
pub struct Rebalance<'info> {
    #[account(address = config.keeper @ VaultError::Unauthorized)]
    pub keeper: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut)]
    pub bucket: Box<Account<'info, Bucket>>,
    /// CHECK: only compared against the swap accounts by the guard.
    #[account(address = bucket.token_mint)]
    pub bucket_mint: UncheckedAccount<'info>,
    /// CHECK: checked against the holding's recorded vault address.
    #[account(mut)]
    pub from_vault: UncheckedAccount<'info>,
    /// CHECK: checked against the holding's recorded vault address.
    #[account(mut)]
    pub to_vault: UncheckedAccount<'info>,
    #[account(seeds = [ASSET_SEED, from_asset.mint.as_ref()], bump = from_asset.bump)]
    pub from_asset: Box<Account<'info, Asset>>,
    #[account(seeds = [ASSET_SEED, to_asset.mint.as_ref()], bump = to_asset.bump)]
    pub to_asset: Box<Account<'info, Asset>>,
    /// CHECK: must be in `config.swap_programs`.
    pub swap_program: UncheckedAccount<'info>,
}

/// One vault trade toward the active weights. Keeper-only, allowed mints only
/// (both sides must be holdings of this bucket), output lands back in the
/// vault, and the trade must go from an over-weight holding to an
/// under-weight one, sized within both the excess and the shortfall, inside the slippage
/// bound. The vault valuation from the last settlement sets the target values,
/// so call `settle_commission` shortly before.
/// remaining: the swap instruction's accounts, in order.
pub fn rebalance<'info>(
    ctx: Context<'_, '_, 'info, 'info, Rebalance<'info>>,
    qty_in: u64,
    min_out: u64,
    swap_data: Vec<u8>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = ctx.accounts;
    let params = a.config.params;
    require!(a.config.is_swap_program(a.swap_program.key), VaultError::SwapProgramNotAllowed);
    require!(now - a.bucket.last_valued_at <= params.max_price_age_secs, VaultError::StaleValuation);
    require!(a.from_asset.is_fresh(now, &params) && a.to_asset.is_fresh(now, &params), VaultError::StalePrice);

    let fi = a.bucket.find(&a.from_asset.mint).ok_or(VaultError::HoldingAccounts)?;
    let ti = a.bucket.find(&a.to_asset.mint).ok_or(VaultError::HoldingAccounts)?;
    require!(fi != ti, VaultError::RebalanceDirection);
    let from = a.bucket.holdings[fi];
    let to = a.bucket.holdings[ti];
    require_keys_eq!(a.from_vault.key(), from.vault, VaultError::VaultAccount);
    require_keys_eq!(a.to_vault.key(), to.vault, VaultError::VaultAccount);
    require!(to.weight_bps > 0, VaultError::RebalanceDirection);

    let from_before = vault::token_amount(&a.from_vault)?;
    let to_before = vault::token_amount(&a.to_vault)?;
    let from_available = from_before.saturating_sub(from.reserved);
    require!(qty_in > 0 && qty_in <= from_available, VaultError::LegOverflow);

    let total = a.bucket.last_value_e6 as u128;
    let from_value = math::value_e6(from_available, a.from_asset.price_e6, from.decimals);
    let to_value = math::value_e6(to_before.saturating_sub(to.reserved), a.to_asset.price_e6, to.decimals);
    let from_target = total * from.weight_bps as u128 / BPS as u128;
    let to_target = total * to.weight_bps as u128 / BPS as u128;
    require!(from_value > from_target && to_value < to_target, VaultError::RebalanceDirection);
    // Sized within both the seller's excess and the buyer's shortfall, so no
    // trade can push a holding past its target and invite a trade back.
    let trade_value = math::value_e6(qty_in, a.from_asset.price_e6, from.decimals);
    require!(
        trade_value <= from_value - from_target && trade_value <= to_target - to_value,
        VaultError::RebalanceDirection
    );

    let bucket_key = a.bucket.key();
    vault::guard_swap_accounts(ctx.remaining_accounts, &bucket_key, &a.bucket_mint.key(), &[from.vault, to.vault])?;
    let id = a.bucket.id.to_le_bytes();
    let bucket = &a.bucket;
    vault::invoke_swap(&a.swap_program, ctx.remaining_accounts, swap_data, &bucket_key, bucket_seeds!(bucket, id))?;

    let from_after = vault::token_amount(&a.from_vault)?;
    let to_after = vault::token_amount(&a.to_vault)?;
    vault::assert_no_authority_change(&a.from_vault, &bucket_key)?;
    vault::assert_no_authority_change(&a.to_vault, &bucket_key)?;
    let spent = from_before.checked_sub(from_after).ok_or(VaultError::OverSpent)?;
    require!(spent > 0 && spent <= qty_in, VaultError::OverSpent);
    let got = to_after.checked_sub(to_before).ok_or(VaultError::OutputTooLow)?;
    require!(got >= min_out && got > 0, VaultError::OutputTooLow);
    let allowed = params.max_slippage_bps as u64 + a.from_asset.extra_cost_bps as u64 + a.to_asset.extra_cost_bps as u64;
    require!(
        math::within_slippage(
            math::value_e6(got, a.to_asset.price_e6, to.decimals),
            math::value_e6(spent, a.from_asset.price_e6, from.decimals),
            allowed,
        ),
        VaultError::SlippageExceeded
    );

    // A holding an edit removed disappears once it is fully sold and owes nothing.
    if from.weight_bps == 0 && from_after == 0 && from.reserved == 0 {
        a.bucket.holdings.remove(fi);
    }
    emit!(Rebalanced {
        bucket: bucket_key,
        from_mint: from.mint,
        to_mint: to.mint,
        qty_in: spent,
        qty_out: got,
        from_balance: from_after,
        to_balance: to_after,
        ts: now,
    });
    Ok(())
}
