use anchor_lang::prelude::*;

use crate::errors::VaultError;
use crate::events::*;
use crate::instructions::recipe;
use crate::math;
use crate::state::*;
use crate::vault;

#[derive(Accounts)]
pub struct ProposeEdit<'info> {
    pub creator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, has_one = creator @ VaultError::Unauthorized)]
    pub bucket: Box<Account<'info, Bucket>>,
}

fn store_pending(bucket_key: Pubkey, bucket: &mut Bucket, lines: Vec<PendingHolding>, note: String, effective_at: i64, forced: bool, now: i64) {
    let holdings = lines.iter().map(|l| WeightEntry { mint: l.mint, weight_bps: l.weight_bps }).collect();
    bucket.pending = lines;
    bucket.pending_note = note.clone();
    bucket.pending_effective_at = effective_at;
    emit!(EditProposed {
        bucket: bucket_key,
        version: bucket.version + 1,
        holdings,
        note,
        effective_at,
        forced,
        ts: now,
    });
}

/// A new recipe under the creation rules, public for 24 hours before it takes
/// effect, at most once per cooldown. New vault token accounts must be created
/// by the creator (the SDK adds them to the same transaction, creator paying).
/// remaining: one `Asset` per holding of the new recipe.
pub fn propose_edit<'info>(
    ctx: Context<'_, '_, 'info, 'info, ProposeEdit<'info>>,
    weights_bps: Vec<u16>,
    note: String,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let params = ctx.accounts.config.params;
    let bucket_key = ctx.accounts.bucket.key();
    let bucket = &mut ctx.accounts.bucket;
    require!(bucket.status == BucketStatus::Open, VaultError::BucketClosed);
    require!(!bucket.has_pending(), VaultError::EditPending);
    require!(note.len() <= MAX_NOTE_LEN, VaultError::NoteLength);
    require!(
        bucket.last_edit_proposed_at == 0 || now - bucket.last_edit_proposed_at >= params.edit_cooldown_secs,
        VaultError::EditCooldown
    );
    let held: Vec<Holding> = bucket.holdings.clone();
    let lines = recipe::validate(&params, &bucket_key, &weights_bps, ctx.remaining_accounts, |m| {
        held.iter().find(|h| h.mint == *m).map(|h| h.vault)
    })?;
    let added = lines.iter().filter(|l| bucket.find(&l.mint).is_none()).count();
    require!(bucket.holdings.len() + added <= MAX_ENTRIES, VaultError::TooManyEntries);
    bucket.last_edit_proposed_at = now;
    let pending = lines
        .into_iter()
        .map(|l| PendingHolding { mint: l.mint, vault: l.vault, decimals: l.decimals, weight_bps: l.weight_bps })
        .collect();
    store_pending(bucket_key, bucket, pending, note, now + params.edit_delay_secs, false, now);
    Ok(())
}

#[derive(Accounts)]
pub struct AdminProposeRemoval<'info> {
    #[account(address = config.admin @ VaultError::Unauthorized)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut)]
    pub bucket: Box<Account<'info, Bucket>>,
}

/// Force-removes a delisted token with the same public notice as any edit.
/// The removed weight is spread over the remaining holdings pro rata, in whole
/// percentages, then clamped to each holding's cap with the overflow moved to
/// holdings that still have room. Replaces any pending edit (minus the token)
/// and ignores the creator's cooldown. Fails if the rules cannot be met (e.g.
/// too few holdings left): then the bucket should be closed instead.
/// remaining: one `Asset` per kept holding, in order.
pub fn admin_propose_removal<'info>(
    ctx: Context<'_, '_, 'info, 'info, AdminProposeRemoval<'info>>,
    mint: Pubkey,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let params = ctx.accounts.config.params;
    let bucket_key = ctx.accounts.bucket.key();
    let bucket = &mut ctx.accounts.bucket;
    let base: Vec<PendingHolding> = if bucket.has_pending() {
        bucket.pending.clone()
    } else {
        bucket
            .holdings
            .iter()
            .filter(|h| h.weight_bps > 0)
            .map(|h| PendingHolding { mint: h.mint, vault: h.vault, decimals: h.decimals, weight_bps: h.weight_bps })
            .collect()
    };
    let kept: Vec<PendingHolding> = base.into_iter().filter(|p| p.mint != mint).collect();
    require!(kept.len() >= params.min_holdings as usize, VaultError::HoldingCount);
    require!(ctx.remaining_accounts.len() >= kept.len(), VaultError::HoldingAccounts);
    let mut caps = Vec::with_capacity(kept.len());
    for (i, p) in kept.iter().enumerate() {
        let asset: Account<Asset> = Account::try_from(&ctx.remaining_accounts[i])?;
        require_keys_eq!(asset.mint, p.mint, VaultError::HoldingAccounts);
        caps.push(asset.max_weight_bps(&params));
    }
    let weights = math::renormalize_percent(&kept.iter().map(|p| p.weight_bps).collect::<Vec<_>>());
    let weights = math::cap_weights(&weights, &caps).ok_or(VaultError::WeightTooHigh)?;
    let pending = kept
        .into_iter()
        .zip(weights)
        .map(|(p, w)| PendingHolding { weight_bps: w, ..p })
        .collect();
    let note = String::from("Removed by Bucket: token delisted by its issuer.");
    store_pending(bucket_key, bucket, pending, note, now + params.edit_delay_secs, true, now);
    Ok(())
}

#[derive(Accounts)]
pub struct ActivateEdit<'info> {
    #[account(mut)]
    pub bucket: Box<Account<'info, Bucket>>,
}

/// Anyone can promote a pending edit once its notice period has passed.
/// Holdings the edit drops stay as zero-weight entries until the keeper has
/// sold them down. remaining: the vault account of every holding the edit adds.
pub fn activate_edit<'info>(ctx: Context<'_, '_, 'info, 'info, ActivateEdit<'info>>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let bucket_key = ctx.accounts.bucket.key();
    let bucket = &mut ctx.accounts.bucket;
    require!(bucket.has_pending(), VaultError::NoPendingEdit);
    require!(now >= bucket.pending_effective_at, VaultError::EditNotEffective);

    for h in bucket.holdings.iter_mut() {
        h.weight_bps = 0;
    }
    let mut new_vaults = ctx.remaining_accounts.iter();
    let pending = bucket.pending.clone();
    for p in pending.iter() {
        match bucket.find(&p.mint) {
            Some(i) => bucket.holdings[i].weight_bps = p.weight_bps,
            None => {
                let ai = new_vaults.next().ok_or(VaultError::VaultAccount)?;
                require_keys_eq!(*ai.key, p.vault, VaultError::VaultAccount);
                let (mint, owner, _) = vault::read_token_account(ai)?;
                require!(mint == p.mint && owner == bucket_key, VaultError::VaultAccount);
                bucket.holdings.push(Holding {
                    mint: p.mint,
                    vault: p.vault,
                    decimals: p.decimals,
                    weight_bps: p.weight_bps,
                    reserved: 0,
                });
            }
        }
    }
    require!(bucket.holdings.len() <= MAX_ENTRIES, VaultError::TooManyEntries);
    bucket.version += 1;
    bucket.pending.clear();
    bucket.pending_note.clear();
    bucket.pending_effective_at = 0;
    emit!(EditActivated {
        bucket: bucket_key,
        version: bucket.version,
        holdings: pending.iter().map(|p| WeightEntry { mint: p.mint, weight_bps: p.weight_bps }).collect(),
        ts: now,
    });
    Ok(())
}
