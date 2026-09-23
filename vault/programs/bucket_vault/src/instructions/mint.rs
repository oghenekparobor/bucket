use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, CloseAccount, Mint, MintTo, Token, TokenAccount, Transfer};

use crate::errors::VaultError;
use crate::events::*;
use crate::math;
use crate::state::*;
use crate::vault::{self, SettleAccounts};

#[derive(Accounts)]
#[instruction(amount_e6: u64, nonce: u64, rent_fee_e6: u64)]
pub struct OpenMint<'info> {
    pub backer: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut)]
    pub bucket: Box<Account<'info, Bucket>>,
    #[account(mut, address = bucket.token_mint)]
    pub bucket_mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [CREATOR_FEE_SEED, bucket.key().as_ref()], bump)]
    pub creator_fee: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [PLATFORM_FEE_SEED, bucket.key().as_ref()], bump)]
    pub platform_fee: Box<Account<'info, TokenAccount>>,
    #[account(address = config.usdc_mint)]
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = usdc_mint, token::authority = backer)]
    pub backer_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = usdc_mint, token::authority = config.fee_wallet)]
    pub fee_wallet_usdc: Box<Account<'info, TokenAccount>>,
    #[account(
        init, payer = payer, space = 8 + MintOrder::INIT_SPACE,
        seeds = [MINT_ORDER_SEED, bucket.key().as_ref(), backer.key().as_ref(), &nonce.to_le_bytes()], bump
    )]
    pub order: Box<Account<'info, MintOrder>>,
    #[account(
        init, payer = payer,
        associated_token::mint = usdc_mint, associated_token::authority = order,
        associated_token::token_program = token_program,
    )]
    pub escrow: Box<Account<'info, TokenAccount>>,
    #[account(
        init_if_needed, payer = payer,
        associated_token::mint = bucket_mint, associated_token::authority = backer,
        associated_token::token_program = token_program,
    )]
    pub backer_bucket_ata: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Takes the backer's USDC into an order escrow and fixes how it will be
/// spent. Settles commission first so nobody enters ahead of a fee.
/// `rent_fee_e6` lets a sponsor that paid the rent for the backer's new bucket
/// token account recover it in USDC (at most $1, only when the payer is not
/// the backer); the backer signs, so it is shown and agreed before confirming.
/// remaining: `[asset_i, vault_i]` per holding.
pub fn open_mint<'info>(
    ctx: Context<'_, '_, 'info, 'info, OpenMint<'info>>,
    amount_e6: u64,
    nonce: u64,
    rent_fee_e6: u64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = ctx.accounts;
    let params = a.config.params;
    require!(!params.mints_paused, VaultError::MintsPaused);
    require!(a.bucket.status == BucketStatus::Open, VaultError::BucketClosed);
    let backer = a.backer.key();
    require!(rent_fee_e6 <= MAX_RENT_FEE_E6, VaultError::InvalidParam);
    require!(rent_fee_e6 == 0 || a.payer.key() != backer, VaultError::InvalidParam);
    if a.bucket.creator_funded {
        require!(amount_e6 >= params.min_deposit_e6, VaultError::BelowMinimum);
    } else {
        require_keys_eq!(backer, a.bucket.creator, VaultError::CreatorNotFunded);
        require!(amount_e6 >= params.min_creator_deposit_e6, VaultError::BelowMinimum);
    }

    let bucket_key = a.bucket.key();
    let views = vault::load_holdings(&a.bucket, &bucket_key, ctx.remaining_accounts, now, &params)?;
    require!(views.iter().all(|v| v.fresh), VaultError::StalePrice);
    let bucket_ai = a.bucket.to_account_info();
    let supply = vault::settle(
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
        a.bucket_mint.supply,
        &views,
        now,
    )?;

    let fee = (amount_e6 as u128 * params.mint_fee_bps as u128 / BPS as u128) as u64;
    let net = amount_e6 - fee;
    let vault_value = vault::value(&views).spot_e6;
    if params.vault_cap_e6 > 0 {
        require!(vault_value + net as u128 <= params.vault_cap_e6 as u128, VaultError::VaultCap);
    }

    // An empty vault (or one emptied by redeems) starts at the high-water mark.
    // Until the creator's funding order has filled, budgets follow the recipe's
    // target weights, so a partial first fill cannot skew the vault. After
    // that, every mint follows the vault's current value proportions.
    let empty = supply == 0 || (vault_value == 0 && supply <= DUST_SUPPLY);
    let unit_price = if empty {
        a.bucket.hwm_e6
    } else {
        require!(vault_value > 0, VaultError::ZeroVaultValue);
        math::unit_price_e6(vault_value, supply)
    };
    let weights: Vec<u128> = if empty || !a.bucket.creator_funded {
        views.iter().map(|v| v.weight_bps as u128).collect()
    } else {
        views.iter().map(|v| v.spot_value_e6()).collect()
    };
    let budgets = math::split_proportional(net, &weights);

    for (to, amount) in [(a.fee_wallet_usdc.to_account_info(), fee + rent_fee_e6), (a.escrow.to_account_info(), net)] {
        if amount == 0 {
            continue;
        }
        token::transfer(
            CpiContext::new(
                a.token_program.to_account_info(),
                Transfer { from: a.backer_usdc.to_account_info(), to, authority: a.backer.to_account_info() },
            ),
            amount,
        )?;
    }

    let order = &mut a.order;
    order.bucket = bucket_key;
    order.backer = backer;
    order.rent_payer = a.payer.key();
    order.nonce = nonce;
    order.created_at = now;
    order.expires_at = now + params.order_ttl_secs;
    order.unit_price_e6 = unit_price;
    order.usdc_total_e6 = net;
    order.tokens_issued = 0;
    order.bump = ctx.bumps.order;
    order.legs = views
        .iter()
        .zip(budgets.iter())
        .map(|(v, &b)| MintLeg {
            mint: v.mint,
            budget_e6: b,
            spent_e6: 0,
            price_e6: v.price_e6,
            qty: 0,
            tokens: 0,
            done: b < LEG_DUST_E6,
        })
        .collect();

    emit!(MintOpened {
        order: order.key(),
        bucket: bucket_key,
        backer,
        amount_e6,
        fee_e6: fee,
        net_e6: net,
        rent_fee_e6,
        unit_price_e6: unit_price,
        legs: order.legs.iter().map(|l| AmountEntry { mint: l.mint, amount: l.budget_e6 }).collect(),
        ts: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct FillMint<'info> {
    /// The keeper, or the backer filling their own order.
    pub signer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut)]
    pub bucket: Box<Account<'info, Bucket>>,
    #[account(mut, address = bucket.token_mint)]
    pub bucket_mint: Box<Account<'info, Mint>>,
    #[account(mut, has_one = bucket)]
    pub order: Box<Account<'info, MintOrder>>,
    #[account(
        mut,
        associated_token::mint = config.usdc_mint, associated_token::authority = order,
        associated_token::token_program = token_program,
    )]
    pub escrow: Box<Account<'info, TokenAccount>>,
    /// CHECK: checked against the holding's recorded vault address.
    #[account(mut)]
    pub vault: UncheckedAccount<'info>,
    #[account(seeds = [ASSET_SEED, asset.mint.as_ref()], bump = asset.bump)]
    pub asset: Box<Account<'info, Asset>>,
    #[account(mut, token::mint = bucket_mint, token::authority = order.backer)]
    pub backer_bucket_ata: Box<Account<'info, TokenAccount>>,
    /// CHECK: must be in `config.swap_programs`.
    pub swap_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

/// Buys one holding with part of the escrow and issues bucket tokens for it.
/// The swap is signed by the order PDA, which owns nothing but the escrow.
/// remaining: the swap instruction's accounts, in order.
pub fn fill_mint<'info>(
    ctx: Context<'_, '_, 'info, 'info, FillMint<'info>>,
    leg_index: u8,
    usdc_in: u64,
    min_out: u64,
    swap_data: Vec<u8>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = ctx.accounts;
    let signer = a.signer.key();
    require!(signer == a.config.keeper || signer == a.order.backer, VaultError::Unauthorized);
    require!(now < a.order.expires_at, VaultError::OrderExpired);
    require!(a.config.is_swap_program(a.swap_program.key), VaultError::SwapProgramNotAllowed);
    let li = leg_index as usize;
    require!(li < a.order.legs.len(), VaultError::LegIndex);
    let leg = a.order.legs[li];
    require!(!leg.done, VaultError::LegDone);
    require!(usdc_in > 0 && usdc_in <= leg.budget_e6 - leg.spent_e6, VaultError::LegOverflow);
    require_keys_eq!(a.asset.mint, leg.mint, VaultError::HoldingAccounts);
    let holding = a.bucket.find(&leg.mint).map(|i| a.bucket.holdings[i]).ok_or(VaultError::HoldingAccounts)?;
    require_keys_eq!(a.vault.key(), holding.vault, VaultError::VaultAccount);

    let bucket_key = a.bucket.key();
    vault::guard_swap_accounts(ctx.remaining_accounts, &bucket_key, &a.bucket_mint.key(), &[holding.vault])?;

    let escrow_before = a.escrow.amount;
    let vault_before = vault::token_amount(&a.vault)?;
    let order_key = a.order.key();
    let nonce = a.order.nonce.to_le_bytes();
    let backer = a.order.backer;
    let order_seeds: &[&[u8]] = &[MINT_ORDER_SEED, bucket_key.as_ref(), backer.as_ref(), &nonce, &[a.order.bump]];
    vault::invoke_swap(&a.swap_program, ctx.remaining_accounts, swap_data, &order_key, order_seeds)?;

    a.escrow.reload()?;
    let spent = escrow_before.checked_sub(a.escrow.amount).ok_or(VaultError::OverSpent)?;
    require!(spent <= usdc_in, VaultError::OverSpent);
    vault::assert_no_authority_change(&a.escrow.to_account_info(), &order_key)?;
    let vault_after = vault::token_amount(&a.vault)?;
    let qty = vault_after.checked_sub(vault_before).ok_or(VaultError::OutputTooLow)?;
    require!(qty >= min_out && qty > 0, VaultError::OutputTooLow);
    let value_in = math::value_e6(qty, leg.price_e6, holding.decimals);
    let allowed = a.config.params.max_slippage_bps as u64 + a.asset.extra_cost_bps as u64;
    require!(math::within_slippage(value_in, spent as u128, allowed), VaultError::SlippageExceeded);

    let tokens = math::mint_tokens(qty, leg.price_e6, holding.decimals, spent, a.order.unit_price_e6);
    if tokens > 0 {
        let bucket = &a.bucket;
        let id = bucket.id.to_le_bytes();
        token::mint_to(
            CpiContext::new_with_signer(
                a.token_program.to_account_info(),
                MintTo {
                    mint: a.bucket_mint.to_account_info(),
                    to: a.backer_bucket_ata.to_account_info(),
                    authority: a.bucket.to_account_info(),
                },
                &[bucket_seeds!(bucket, id)],
            ),
            tokens,
        )?;
    }

    let order = &mut a.order;
    let leg = &mut order.legs[li];
    leg.spent_e6 += spent;
    leg.qty += qty;
    leg.tokens += tokens;
    leg.done = leg.budget_e6 - leg.spent_e6 < LEG_DUST_E6;
    order.tokens_issued += tokens;
    // The bucket opens to other backers only once a creator order has filled
    // completely (≥ the $25 minimum, in the recipe's weights). A partly
    // filled or abandoned creator order does not count.
    if backer == a.bucket.creator && !a.bucket.creator_funded && order.all_done() {
        a.bucket.creator_funded = true;
    }
    a.bucket_mint.reload()?;
    emit!(MintFilled {
        order: order_key,
        bucket: bucket_key,
        backer,
        leg: leg_index,
        mint: holding.mint,
        usdc_spent: spent,
        qty,
        tokens,
        vault_balance: vault_after,
        supply: a.bucket_mint.supply,
        ts: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CloseMintOrder<'info> {
    pub signer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, close = rent_payer)]
    pub order: Box<Account<'info, MintOrder>>,
    #[account(
        mut,
        associated_token::mint = config.usdc_mint, associated_token::authority = order,
        associated_token::token_program = token_program,
    )]
    pub escrow: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = config.usdc_mint, token::authority = order.backer)]
    pub backer_usdc: Box<Account<'info, TokenAccount>>,
    /// CHECK: receives the order's rent back.
    #[account(mut, address = order.rent_payer)]
    pub rent_payer: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

/// Returns unspent USDC to the backer and closes the order. The backer or the
/// keeper can close at any time (a failed or out-of-bounds leg is abandoned
/// this way); anyone can close once every leg is done or the order expired.
pub fn close_mint_order(ctx: Context<CloseMintOrder>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = &ctx.accounts;
    let order = &a.order;
    let signer = a.signer.key();
    require!(
        signer == order.backer || signer == a.config.keeper || order.all_done() || now >= order.expires_at,
        VaultError::OrderNotFinished
    );
    let nonce = order.nonce.to_le_bytes();
    let seeds: &[&[u8]] = &[MINT_ORDER_SEED, order.bucket.as_ref(), order.backer.as_ref(), &nonce, &[order.bump]];
    let refund = a.escrow.amount;
    if refund > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                a.token_program.to_account_info(),
                Transfer {
                    from: a.escrow.to_account_info(),
                    to: a.backer_usdc.to_account_info(),
                    authority: a.order.to_account_info(),
                },
                &[seeds],
            ),
            refund,
        )?;
    }
    token::close_account(CpiContext::new_with_signer(
        a.token_program.to_account_info(),
        CloseAccount {
            account: a.escrow.to_account_info(),
            destination: a.rent_payer.to_account_info(),
            authority: a.order.to_account_info(),
        },
        &[seeds],
    ))?;
    emit!(MintClosed {
        order: order.key(),
        bucket: order.bucket,
        backer: order.backer,
        refunded_e6: refund,
        tokens_total: order.tokens_issued,
        ts: now,
    });
    Ok(())
}
