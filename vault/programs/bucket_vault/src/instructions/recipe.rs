//! Recipe rules shared by `create_bucket` and `propose_edit`.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;

use crate::errors::VaultError;
use crate::state::*;

/// One validated line of a recipe.
pub struct RecipeLine {
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub decimals: u8,
    pub weight_bps: u16,
}

/// Reads one `Asset` per weight from `remaining` and enforces the recipe rules:
/// holding count, unique mints, whole-percent weights between the minimum and
/// the cap for the asset type, sum of 100%, and allowed mints only.
/// `already_held` lets an edit keep a token that has since been disabled.
pub fn validate<'info>(
    params: &ConfigParams,
    bucket_key: &Pubkey,
    weights: &[u16],
    remaining: &'info [AccountInfo<'info>],
    already_held: impl Fn(&Pubkey) -> Option<Pubkey>,
) -> Result<Vec<RecipeLine>> {
    let n = weights.len();
    require!(
        n >= params.min_holdings as usize && n <= params.max_holdings as usize,
        VaultError::HoldingCount
    );
    require!(remaining.len() >= n, VaultError::HoldingAccounts);
    let mut lines: Vec<RecipeLine> = Vec::with_capacity(n);
    let mut sum: u64 = 0;
    for (i, &w) in weights.iter().enumerate() {
        let asset: Account<Asset> = Account::try_from(&remaining[i])?;
        require!(w % 100 == 0, VaultError::WeightNotWholePercent);
        require!(w >= params.min_weight_bps, VaultError::WeightTooLow);
        require!(w <= asset.max_weight_bps(params), VaultError::WeightTooHigh);
        require!(lines.iter().all(|l| l.mint != asset.mint), VaultError::DuplicateHolding);
        let vault = match already_held(&asset.mint) {
            Some(vault) => vault,
            None => {
                require!(asset.enabled && !asset.flagged, VaultError::AssetNotAllowed);
                get_associated_token_address_with_program_id(bucket_key, &asset.mint, &asset.token_program)
            }
        };
        sum += w as u64;
        lines.push(RecipeLine { mint: asset.mint, vault, decimals: asset.decimals, weight_bps: w });
    }
    require!(sum == BPS, VaultError::WeightSum);
    Ok(lines)
}
