use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};
use anchor_spl::token_interface::{self, Mint as AnyMint, TokenAccount as AnyTokenAccount, TokenInterface, TransferChecked};

use crate::errors::VaultError;
use crate::events::*;
use crate::math;
use crate::state::*;
use crate::vault::{self, SettleAccounts};

#[derive(Accounts)]
#[instruction(tokens: u64, nonce: u64)]
pub struct Redeem<'info> {
    pub holder: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut)]
    pub bucket: Box<Account<'info, Bucket>>,
    #[account(mut, address = bucket.token_mint)]
    pub bucket_mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = bucket_mint, token::authority = holder)]
    pub holder_bucket_ata: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [CREATOR_FEE_SEED, bucket.key().as_ref()], bump)]
    pub creator_fee: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [PLATFORM_FEE_SEED, bucket.key().as_ref()], bump)]
    pub platform_fee: Box<Account<'info, TokenAccount>>,
    #[account(
        init, payer = payer, space = 8 + RedeemOrder::INIT_SPACE,
        seeds = [REDEEM_ORDER_SEED, bucket.key().as_ref(), holder.key().as_ref(), &nonce.to_le_bytes()], bump
    )]
    pub order: Box<Account<'info, RedeemOrder>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Burns bucket tokens and reserves the holder's pro-rata slice of every
/// holding. Works whether or not the bucket is closed. Needs no price: if any
/// price is stale, commission settlement is skipped rather than blocking the exit.
/// remaining: `[asset_i, vault_i]` per holding.
pub fn redeem<'info>(ctx: Context<'_, '_, 'info, 'info, Redeem<'info>>, tokens: u64, nonce: u64) -> Result<()> {
    require!(tokens > 0, VaultError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;
    let a = ctx.accounts;
    let params = a.config.params;
    let bucket_key = a.bucket.key();
    let views = vault::load_holdings(&a.bucket, &bucket_key, ctx.remaining_accounts, now, &params)?;
    let settled = views.iter().all(|v| v.fresh);
    let mut supply = a.bucket_mint.supply;
    if settled {
        let bucket_ai = a.bucket.to_account_info();
        supply = vault::settle(
            &a.config,
            &mut a.bucket,
            SettleAccounts {
                bucket_key,
                bucket_mint: &a.bucket_mint.to_account_info(),
                bucket_authority: &bucket_ai,
                creator_fee: &a.creator_fee.to_account_info(),
                platform_fee: &a.platform_fee.to_account_info(),
                token_program: &a.token_program.to_account_info(),
            },
            supply,
            &views,
            now,
        )?;
    }

    let fee_tokens = (tokens as u128 * params.redeem_fee_bps as u128 / BPS as u128) as u64;
    let burn = tokens - fee_tokens;
    if fee_tokens > 0 {
        token::transfer(
            CpiContext::new(
                a.token_program.to_account_info(),
                Transfer {
                    from: a.holder_bucket_ata.to_account_info(),
                    to: a.platform_fee.to_account_info(),
                    authority: a.holder.to_account_info(),
                },
            ),
            fee_tokens,
        )?;
    }
    token::burn(
        CpiContext::new(
            a.token_program.to_account_info(),
            Burn {
                mint: a.bucket_mint.to_account_info(),
                from: a.holder_bucket_ata.to_account_info(),
                authority: a.holder.to_account_info(),
            },
        ),
        burn,
    )?;

    let unit_price = math::unit_price_e6(vault::value(&views).spot_e6, supply);
    let mut legs = Vec::with_capacity(views.len());
    for (i, v) in views.iter().enumerate() {
        let mut qty = math::redeem_qty(v.available(), burn, supply);
        // A slice worth under a cent cannot be sold; it stays with the remaining holders.
        if math::value_e6(qty, v.price_e6, v.decimals) < LEG_DUST_E6 as u128 {
            qty = 0;
        }
        a.bucket.holdings[i].reserved += qty;
        legs.push(RedeemLeg { mint: v.mint, qty, sold: 0, usdc_out: 0, claimed: 0, done: qty == 0 });
    }

    let order = &mut a.order;
    order.bucket = bucket_key;
    order.holder = a.holder.key();
    order.rent_payer = a.payer.key();
    order.nonce = nonce;
    order.created_at = now;
    order.unit_price_e6 = unit_price;
    order.tokens_burned = burn;
    order.bump = ctx.bumps.order;
    order.legs = legs;

    emit!(Redeemed {
        order: order.key(),
        bucket: bucket_key,
        holder: order.holder,
        tokens_burned: burn,
        fee_tokens,
        unit_price_e6: unit_price,
        legs: order.legs.iter().map(|l| AmountEntry { mint: l.mint, amount: l.qty }).collect(),
        supply: supply - burn,
        settled,
        ts: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct FillRedeem<'info> {
    /// The keeper, or the holder selling their own slice.
    pub signer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut)]
    pub bucket: Box<Account<'info, Bucket>>,
    /// CHECK: only compared against the swap accounts by the guard.
    #[account(address = bucket.token_mint)]
    pub bucket_mint: UncheckedAccount<'info>,
    #[account(mut, has_one = bucket)]
    pub order: Box<Account<'info, RedeemOrder>>,
    /// CHECK: checked against the holding's recorded vault address.
    #[account(mut)]
    pub vault: UncheckedAccount<'info>,
    #[account(seeds = [ASSET_SEED, asset.mint.as_ref()], bump = asset.bump)]
    pub asset: Box<Account<'info, Asset>>,
    #[account(mut, token::mint = config.usdc_mint, token::authority = order.holder)]
    pub holder_usdc: Box<Account<'info, TokenAccount>>,
    /// CHECK: must be in `config.swap_programs`.
    pub swap_program: UncheckedAccount<'info>,
}

/// Sells part of one reserved leg to USDC, paid straight to the holder. The
/// swap is signed by the bucket PDA; the guard keeps every other vault account
/// and the bucket mint out of the CPI, and the source may lose at most `qty`.
/// A keeper fill must also clear the slippage bound against the on-chain
/// price; a holder filling their own leg sets their own `min_usdc_out`.
/// remaining: the swap instruction's accounts, in order.
pub fn fill_redeem<'info>(
    ctx: Context<'_, '_, 'info, 'info, FillRedeem<'info>>,
    leg_index: u8,
    qty: u64,
    min_usdc_out: u64,
    swap_data: Vec<u8>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = ctx.accounts;
    let signer = a.signer.key();
    let is_keeper = signer == a.config.keeper;
    require!(is_keeper || signer == a.order.holder, VaultError::Unauthorized);
    require!(a.config.is_swap_program(a.swap_program.key), VaultError::SwapProgramNotAllowed);
    let li = leg_index as usize;
    require!(li < a.order.legs.len(), VaultError::LegIndex);
    let leg = a.order.legs[li];
    require!(!leg.done, VaultError::LegDone);
    require!(qty > 0 && qty <= leg.remaining(), VaultError::LegOverflow);
    require_keys_eq!(a.asset.mint, leg.mint, VaultError::HoldingAccounts);
    let hi = a.bucket.find(&leg.mint).ok_or(VaultError::HoldingAccounts)?;
    let holding = a.bucket.holdings[hi];
    require_keys_eq!(a.vault.key(), holding.vault, VaultError::VaultAccount);

    let bucket_key = a.bucket.key();
    vault::guard_swap_accounts(ctx.remaining_accounts, &bucket_key, &a.bucket_mint.key(), &[holding.vault])?;

    let vault_before = vault::token_amount(&a.vault)?;
    let usdc_before = a.holder_usdc.amount;
    let id = a.bucket.id.to_le_bytes();
    let bucket = &a.bucket;
    vault::invoke_swap(&a.swap_program, ctx.remaining_accounts, swap_data, &bucket_key, bucket_seeds!(bucket, id))?;

    let vault_after = vault::token_amount(&a.vault)?;
    vault::assert_no_authority_change(&a.vault, &bucket_key)?;
    let sold = vault_before.checked_sub(vault_after).ok_or(VaultError::OverSpent)?;
    require!(sold > 0 && sold <= qty, VaultError::OverSpent);
    a.holder_usdc.reload()?;
    let usdc_out = a.holder_usdc.amount.checked_sub(usdc_before).ok_or(VaultError::OutputTooLow)?;
    require!(usdc_out >= min_usdc_out, VaultError::OutputTooLow);
    if is_keeper {
        require!(a.asset.is_fresh(now, &a.config.params), VaultError::StalePrice);
        let value_sold = math::value_e6(sold, a.asset.price_e6, holding.decimals);
        let allowed = a.config.params.max_slippage_bps as u64 + a.asset.extra_cost_bps as u64;
        require!(math::within_slippage(usdc_out as u128, value_sold, allowed), VaultError::SlippageExceeded);
    }

    a.bucket.holdings[hi].reserved -= sold;
    let order_key = a.order.key();
    let holder = a.order.holder;
    let leg = &mut a.order.legs[li];
    leg.sold += sold;
    leg.usdc_out += usdc_out;
    leg.done = leg.remaining() == 0;
    emit!(RedeemFilled {
        order: order_key,
        bucket: bucket_key,
        holder,
        leg: leg_index,
        mint: holding.mint,
        qty_sold: sold,
        usdc_out,
        vault_balance: vault_after,
        ts: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimRedeemInKind<'info> {
    pub holder: Signer<'info>,
    #[account(mut)]
    pub bucket: Box<Account<'info, Bucket>>,
    #[account(mut, has_one = bucket, has_one = holder)]
    pub order: Box<Account<'info, RedeemOrder>>,
    /// CHECK: checked against the holding's recorded vault address.
    #[account(mut)]
    pub vault: UncheckedAccount<'info>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, AnyMint>>,
    #[account(mut, token::mint = mint, token::authority = holder, token::token_program = token_program)]
    pub holder_token: Box<InterfaceAccount<'info, AnyTokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// The exit that depends on nothing but the chain: the holder takes the
/// unsold part of a leg as the underlying token itself.
pub fn claim_redeem_in_kind(ctx: Context<ClaimRedeemInKind>, leg_index: u8) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = ctx.accounts;
    let li = leg_index as usize;
    require!(li < a.order.legs.len(), VaultError::LegIndex);
    let leg = a.order.legs[li];
    require!(!leg.done, VaultError::LegDone);
    require_keys_eq!(a.mint.key(), leg.mint, VaultError::HoldingAccounts);
    let hi = a.bucket.find(&leg.mint).ok_or(VaultError::HoldingAccounts)?;
    let holding = a.bucket.holdings[hi];
    require_keys_eq!(a.vault.key(), holding.vault, VaultError::VaultAccount);
    let amount = leg.remaining();

    let id = a.bucket.id.to_le_bytes();
    let bucket = &a.bucket;
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            a.token_program.to_account_info(),
            TransferChecked {
                from: a.vault.to_account_info(),
                mint: a.mint.to_account_info(),
                to: a.holder_token.to_account_info(),
                authority: a.bucket.to_account_info(),
            },
            &[bucket_seeds!(bucket, id)],
        ),
        amount,
        a.mint.decimals,
    )?;

    a.bucket.holdings[hi].reserved -= amount;
    let vault_balance = vault::token_amount(&a.vault)?;
    let order_key = a.order.key();
    let leg = &mut a.order.legs[li];
    leg.claimed += amount;
    leg.done = true;
    emit!(RedeemClaimed {
        order: order_key,
        bucket: a.bucket.key(),
        holder: a.holder.key(),
        leg: leg_index,
        mint: holding.mint,
        qty: amount,
        vault_balance,
        ts: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CloseRedeemOrder<'info> {
    #[account(mut, close = rent_payer)]
    pub order: Box<Account<'info, RedeemOrder>>,
    /// CHECK: receives the order's rent back.
    #[account(mut, address = order.rent_payer)]
    pub rent_payer: UncheckedAccount<'info>,
}

/// Anyone can close a redeem order once every leg is sold or claimed.
pub fn close_redeem_order(ctx: Context<CloseRedeemOrder>) -> Result<()> {
    let order = &ctx.accounts.order;
    require!(order.all_done(), VaultError::OrderNotFinished);
    emit!(RedeemClosed {
        order: order.key(),
        bucket: order.bucket,
        holder: order.holder,
        usdc_out_total: order.legs.iter().map(|l| l.usdc_out).sum(),
        ts: Clock::get()?.unix_timestamp,
    });
    Ok(())
}
