//! Shared vault logic: reading holdings from remaining accounts, valuing the
//! vault, settling commission, and guarded swap CPIs.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token::{self, MintTo};

use crate::errors::VaultError;
use crate::events::CommissionSettled;
use crate::math;
use crate::state::*;

/// One holding as read from chain for this instruction.
#[derive(Clone, Copy, Debug)]
pub struct HoldingView {
    pub mint: Pubkey,
    pub decimals: u8,
    pub weight_bps: u16,
    pub balance: u64,
    pub reserved: u64,
    pub price_e6: u64,
    pub conservative_price_e6: u64,
    pub fresh: bool,
    pub extra_cost_bps: u16,
}

impl HoldingView {
    pub fn available(&self) -> u64 {
        self.balance.saturating_sub(self.reserved)
    }
    pub fn spot_value_e6(&self) -> u128 {
        math::value_e6(self.available(), self.price_e6, self.decimals)
    }
    pub fn conservative_value_e6(&self) -> u128 {
        math::value_e6(self.available(), self.conservative_price_e6, self.decimals)
    }
}

pub struct Valuation {
    pub spot_e6: u128,
    pub conservative_e6: u128,
    pub all_fresh: bool,
}

pub fn value(views: &[HoldingView]) -> Valuation {
    Valuation {
        spot_e6: views.iter().map(|v| v.spot_value_e6()).sum(),
        conservative_e6: views.iter().map(|v| v.conservative_value_e6()).sum(),
        all_fresh: views.iter().all(|v| v.fresh),
    }
}

/// Minimal read of an SPL / Token-2022 token account: (mint, owner, amount).
pub fn read_token_account(ai: &AccountInfo) -> Result<(Pubkey, Pubkey, u64)> {
    require!(
        ai.owner == &anchor_spl::token::ID || ai.owner == &anchor_spl::token_2022::ID,
        VaultError::VaultAccount
    );
    let data = ai.try_borrow_data()?;
    require!(is_token_account(&data), VaultError::VaultAccount);
    let mint = Pubkey::try_from(&data[0..32]).unwrap();
    let owner = Pubkey::try_from(&data[32..64]).unwrap();
    let amount = u64::from_le_bytes(data[64..72].try_into().unwrap());
    Ok((mint, owner, amount))
}

/// Reads `[asset_i, vault_i]` pairs from `remaining` for every holding entry,
/// checking each against the bucket's recorded mint and vault address.
pub fn load_holdings<'info>(
    bucket: &Bucket,
    bucket_key: &Pubkey,
    remaining: &'info [AccountInfo<'info>],
    now: i64,
    params: &ConfigParams,
) -> Result<Vec<HoldingView>> {
    let n = bucket.holdings.len();
    require!(remaining.len() >= n * 2, VaultError::HoldingAccounts);
    let mut views = Vec::with_capacity(n);
    for (i, h) in bucket.holdings.iter().enumerate() {
        let asset_ai = &remaining[2 * i];
        let vault_ai = &remaining[2 * i + 1];
        let asset: Account<Asset> = Account::try_from(asset_ai)?;
        require_keys_eq!(asset.mint, h.mint, VaultError::HoldingAccounts);
        require_keys_eq!(*vault_ai.key, h.vault, VaultError::VaultAccount);
        let (mint, owner, amount) = read_token_account(vault_ai)?;
        require_keys_eq!(mint, h.mint, VaultError::VaultAccount);
        require_keys_eq!(owner, *bucket_key, VaultError::VaultAccount);
        views.push(HoldingView {
            mint: h.mint,
            decimals: h.decimals,
            weight_bps: h.weight_bps,
            balance: amount,
            reserved: h.reserved,
            price_e6: asset.price_e6,
            conservative_price_e6: asset.conservative_price_e6(),
            fresh: asset.is_fresh(now, params),
            extra_cost_bps: asset.extra_cost_bps,
        });
    }
    Ok(views)
}

/// Accounts `settle` needs besides the holdings.
pub struct SettleAccounts<'a, 'info> {
    pub bucket_key: Pubkey,
    pub bucket_mint: &'a AccountInfo<'info>,
    pub bucket_authority: &'a AccountInfo<'info>,
    pub creator_fee: &'a AccountInfo<'info>,
    pub platform_fee: &'a AccountInfo<'info>,
    pub token_program: &'a AccountInfo<'info>,
}

/// Commission settlement. Values the vault at `min(spot, twap)` per holding and,
/// if the unit price is above the high-water mark, mints fee tokens into the
/// creator and platform fee accounts and moves the mark up.
/// Returns the supply after settlement.
pub fn settle(
    config: &Config,
    bucket: &mut Bucket,
    accts: SettleAccounts,
    supply: u64,
    views: &[HoldingView],
    now: i64,
) -> Result<u64> {
    let val = value(views);
    bucket.last_settled_at = now;
    bucket.last_value_e6 = val.spot_e6.min(u64::MAX as u128) as u64;
    bucket.last_valued_at = now;

    let Some(c) = math::commission(val.conservative_e6, supply, bucket.hwm_e6, config.params.commission_bps) else {
        return Ok(supply);
    };
    let (creator_tokens, platform_tokens) = math::split_fee(c.fee_tokens, config.params.platform_share_bps);
    let id = bucket.id.to_le_bytes();
    let seeds: &[&[u8]] = bucket_seeds!(bucket, id);
    for (to, amount) in [(accts.creator_fee, creator_tokens), (accts.platform_fee, platform_tokens)] {
        if amount == 0 {
            continue;
        }
        token::mint_to(
            CpiContext::new_with_signer(
                accts.token_program.clone(),
                MintTo {
                    mint: accts.bucket_mint.clone(),
                    to: to.clone(),
                    authority: accts.bucket_authority.clone(),
                },
                &[seeds],
            ),
            amount,
        )?;
    }
    emit!(CommissionSettled {
        bucket: accts.bucket_key,
        vault_value_e6: val.conservative_e6 as u64,
        supply_before: supply,
        unit_price_before_e6: math::unit_price_e6(val.conservative_e6, supply),
        hwm_before_e6: bucket.hwm_e6,
        commission_e6: c.commission_e6,
        creator_tokens,
        platform_tokens,
        hwm_after_e6: c.hwm_after_e6,
        ts: now,
    });
    bucket.hwm_e6 = c.hwm_after_e6;
    Ok(supply + c.fee_tokens)
}

fn is_token_account(data: &[u8]) -> bool {
    data.len() == 165 || (data.len() > 165 && data[165] == 2)
}

fn is_mint(data: &[u8]) -> bool {
    data.len() == 82 || (data.len() > 165 && data[165] == 1)
}

/// Rejects any account a swap CPI must not see: the bucket's token mint, and
/// every token account the bucket PDA owns other than those in `allowed` (the
/// leg's own vault accounts). This is what keeps a swap signed by the bucket
/// PDA from reaching the rest of the vault. The bucket PDA itself may appear,
/// as the swap's signing authority; it is owned by this program, so the swap
/// cannot write to it.
pub fn guard_swap_accounts(
    accounts: &[AccountInfo],
    bucket_key: &Pubkey,
    bucket_mint: &Pubkey,
    allowed: &[Pubkey],
) -> Result<()> {
    for ai in accounts {
        if allowed.contains(ai.key) || ai.key == bucket_key {
            continue;
        }
        require!(ai.key != bucket_mint, VaultError::ForbiddenSwapAccount);
        if ai.owner != &anchor_spl::token::ID && ai.owner != &anchor_spl::token_2022::ID {
            continue;
        }
        let data = ai.try_borrow_data()?;
        if is_token_account(&data) {
            require!(&data[32..64] != bucket_key.as_ref(), VaultError::ForbiddenSwapAccount);
        } else if is_mint(&data) {
            let has_authority = u32::from_le_bytes(data[0..4].try_into().unwrap()) == 1;
            require!(!(has_authority && &data[4..36] == bucket_key.as_ref()), VaultError::ForbiddenSwapAccount);
        }
    }
    Ok(())
}

/// CPI into an allow-listed swap program, passing `accounts` through and
/// signing as `signer` (a PDA of this program).
pub fn invoke_swap<'info>(
    swap_program: &AccountInfo<'info>,
    accounts: &[AccountInfo<'info>],
    data: Vec<u8>,
    signer: &Pubkey,
    signer_seeds: &[&[u8]],
) -> Result<()> {
    let metas = accounts
        .iter()
        .map(|ai| AccountMeta {
            pubkey: *ai.key,
            is_signer: ai.is_signer || ai.key == signer,
            is_writable: ai.is_writable,
        })
        .collect();
    let ix = Instruction { program_id: *swap_program.key, accounts: metas, data };
    let mut infos = accounts.to_vec();
    infos.push(swap_program.clone());
    invoke_signed(&ix, &infos, &[signer_seeds])?;
    Ok(())
}

/// After a swap signed by `owner`: the account must still belong to `owner`,
/// with no delegate and no close authority.
pub fn assert_no_authority_change(ai: &AccountInfo, owner: &Pubkey) -> Result<()> {
    let data = ai.try_borrow_data()?;
    require!(is_token_account(&data), VaultError::VaultAccount);
    require!(&data[32..64] == owner.as_ref(), VaultError::AuthorityChanged);
    // delegate: COption<Pubkey> at 72..108, close_authority: COption<Pubkey> at 129..165
    let delegate_tag = u32::from_le_bytes(data[72..76].try_into().unwrap());
    let close_tag = u32::from_le_bytes(data[129..133].try_into().unwrap());
    require!(delegate_tag == 0 && close_tag == 0, VaultError::AuthorityChanged);
    Ok(())
}

pub fn token_amount(ai: &AccountInfo) -> Result<u64> {
    Ok(read_token_account(ai)?.2)
}
