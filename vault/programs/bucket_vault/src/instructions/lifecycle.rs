use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::errors::VaultError;
use crate::events::*;
use crate::instructions::recipe;
use crate::state::*;
use crate::vault::{self, SettleAccounts};

#[derive(Accounts)]
#[instruction(id: u32)]
pub struct CreateBucket<'info> {
    pub creator: Signer<'info>,
    /// Pays rent. The Bucket fee payer when fees are sponsored.
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        init_if_needed, payer = payer, space = 8 + CreatorState::INIT_SPACE,
        seeds = [CREATOR_SEED, creator.key().as_ref()], bump
    )]
    pub creator_state: Box<Account<'info, CreatorState>>,
    #[account(
        init, payer = payer, space = 8 + Bucket::INIT_SPACE,
        seeds = [BUCKET_SEED, creator.key().as_ref(), &id.to_le_bytes()], bump
    )]
    pub bucket: Box<Account<'info, Bucket>>,
    #[account(
        init, payer = payer,
        seeds = [BUCKET_MINT_SEED, bucket.key().as_ref()], bump,
        mint::decimals = BUCKET_DECIMALS, mint::authority = bucket,
    )]
    pub bucket_mint: Box<Account<'info, Mint>>,
    #[account(
        init, payer = payer,
        seeds = [CREATOR_FEE_SEED, bucket.key().as_ref()], bump,
        token::mint = bucket_mint, token::authority = bucket,
    )]
    pub creator_fee: Box<Account<'info, TokenAccount>>,
    #[account(
        init, payer = payer,
        seeds = [PLATFORM_FEE_SEED, bucket.key().as_ref()], bump,
        token::mint = bucket_mint, token::authority = bucket,
    )]
    pub platform_fee: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// remaining: one `Asset` per holding, in recipe order.
pub fn create_bucket<'info>(
    ctx: Context<'_, '_, 'info, 'info, CreateBucket<'info>>,
    id: u32,
    name: String,
    thesis: String,
    weights_bps: Vec<u16>,
) -> Result<()> {
    let params = ctx.accounts.config.params;
    require!(!name.trim().is_empty() && name.len() <= MAX_NAME_LEN, VaultError::NameLength);
    require!(thesis.len() <= MAX_THESIS_LEN, VaultError::ThesisLength);

    let creator = ctx.accounts.creator.key();
    let cs = &mut ctx.accounts.creator_state;
    if cs.creator == Pubkey::default() {
        cs.creator = creator;
        cs.bump = ctx.bumps.creator_state;
    }
    require!(id == cs.next_bucket_id, VaultError::InvalidParam);
    require!(cs.active_buckets < params.max_active_buckets, VaultError::TooManyBuckets);
    cs.next_bucket_id += 1;
    cs.active_buckets += 1;

    let bucket_key = ctx.accounts.bucket.key();
    let lines = recipe::validate(&params, &bucket_key, &weights_bps, ctx.remaining_accounts, |_| None)?;
    let now = Clock::get()?.unix_timestamp;

    let bucket = &mut ctx.accounts.bucket;
    bucket.creator = creator;
    bucket.id = id;
    bucket.status = BucketStatus::Open;
    bucket.token_mint = ctx.accounts.bucket_mint.key();
    bucket.hwm_e6 = INITIAL_UNIT_PRICE_E6;
    bucket.version = 1;
    bucket.holdings = lines
        .iter()
        .map(|l| Holding { mint: l.mint, vault: l.vault, decimals: l.decimals, weight_bps: l.weight_bps, reserved: 0 })
        .collect();
    bucket.name = name.clone();
    bucket.thesis = thesis.clone();
    bucket.created_at = now;
    bucket.bump = ctx.bumps.bucket;
    bucket.mint_bump = ctx.bumps.bucket_mint;

    emit!(BucketCreated {
        bucket: bucket_key,
        creator,
        id,
        token_mint: bucket.token_mint,
        name,
        thesis,
        holdings: lines.iter().map(|l| WeightEntry { mint: l.mint, weight_bps: l.weight_bps }).collect(),
        ts: now,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateBucketInfo<'info> {
    pub creator: Signer<'info>,
    #[account(mut, has_one = creator @ VaultError::Unauthorized)]
    pub bucket: Box<Account<'info, Bucket>>,
}

/// Name and thesis are editable at any time. Nothing else about the bucket,
/// and nothing about its performance history, is.
pub fn update_bucket_info(ctx: Context<UpdateBucketInfo>, name: String, thesis: String) -> Result<()> {
    require!(!name.trim().is_empty() && name.len() <= MAX_NAME_LEN, VaultError::NameLength);
    require!(thesis.len() <= MAX_THESIS_LEN, VaultError::ThesisLength);
    let bucket = &mut ctx.accounts.bucket;
    bucket.name = name.clone();
    bucket.thesis = thesis.clone();
    emit!(BucketInfoUpdated { bucket: bucket.key(), name, thesis, ts: Clock::get()?.unix_timestamp });
    Ok(())
}

#[derive(Accounts)]
pub struct CloseBucket<'info> {
    pub creator: Signer<'info>,
    #[account(mut, has_one = creator @ VaultError::Unauthorized)]
    pub bucket: Box<Account<'info, Bucket>>,
    #[account(mut, seeds = [CREATOR_SEED, creator.key().as_ref()], bump = creator_state.bump)]
    pub creator_state: Account<'info, CreatorState>,
}

/// Blocks new mints for good. Redeem stays open; the record stays public.
pub fn close_bucket(ctx: Context<CloseBucket>) -> Result<()> {
    let bucket = &mut ctx.accounts.bucket;
    require!(bucket.status == BucketStatus::Open, VaultError::BucketClosed);
    bucket.status = BucketStatus::Closed;
    bucket.pending.clear();
    bucket.pending_note.clear();
    bucket.pending_effective_at = 0;
    ctx.accounts.creator_state.active_buckets -= 1;
    emit!(BucketClosed { bucket: bucket.key(), creator: bucket.creator, ts: Clock::get()?.unix_timestamp });
    Ok(())
}

/// Accounts every settlement needs. Shared by `settle_commission`, `open_mint` and `redeem`.
#[derive(Accounts)]
pub struct SettleCommission<'info> {
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
    pub token_program: Program<'info, Token>,
}

/// Anyone can call. remaining: `[asset_i, vault_i]` per holding.
pub fn settle_commission<'info>(ctx: Context<'_, '_, 'info, 'info, SettleCommission<'info>>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = ctx.accounts;
    let bucket_key = a.bucket.key();
    let views = vault::load_holdings(&a.bucket, &bucket_key, ctx.remaining_accounts, now, &a.config.params)?;
    require!(views.iter().all(|v| v.fresh), VaultError::StalePrice);
    let bucket_ai = a.bucket.to_account_info();
    vault::settle(
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
    // Holdings an edit removed disappear once empty and owed to nobody.
    let empty: Vec<Pubkey> = views
        .iter()
        .filter(|v| v.weight_bps == 0 && v.balance == 0 && v.reserved == 0)
        .map(|v| v.mint)
        .collect();
    a.bucket.holdings.retain(|h| !empty.contains(&h.mint));
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimFees<'info> {
    pub signer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    pub bucket: Box<Account<'info, Bucket>>,
    /// The bucket's creator_fee or platform_fee account.
    #[account(mut, token::authority = bucket)]
    pub fee_account: Account<'info, TokenAccount>,
    #[account(mut, token::mint = bucket.token_mint)]
    pub destination: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

/// Moves commission tokens from a fee account to the creator (creator signs)
/// or the platform fee wallet (anyone may trigger; destination is fixed).
pub fn claim_fees(ctx: Context<ClaimFees>, creator: bool) -> Result<()> {
    let a = &ctx.accounts;
    let bucket = &a.bucket;
    let bucket_key = bucket.key();
    let (seed, recipient) = if creator {
        require_keys_eq!(a.signer.key(), bucket.creator, VaultError::Unauthorized);
        (CREATOR_FEE_SEED, bucket.creator)
    } else {
        (PLATFORM_FEE_SEED, a.config.fee_wallet)
    };
    let (expected, _) = Pubkey::find_program_address(&[seed, bucket_key.as_ref()], &crate::ID);
    require_keys_eq!(a.fee_account.key(), expected, VaultError::VaultAccount);
    require_keys_eq!(a.destination.owner, recipient, VaultError::Unauthorized);
    let amount = a.fee_account.amount;
    if amount > 0 {
        let id = bucket.id.to_le_bytes();
        token::transfer(
            CpiContext::new_with_signer(
                a.token_program.to_account_info(),
                Transfer {
                    from: a.fee_account.to_account_info(),
                    to: a.destination.to_account_info(),
                    authority: a.bucket.to_account_info(),
                },
                &[bucket_seeds!(bucket, id)],
            ),
            amount,
        )?;
    }
    emit!(FeesClaimed { bucket: bucket_key, recipient, creator, tokens: amount, ts: Clock::get()?.unix_timestamp });
    Ok(())
}
