//! Metaplex token metadata for a bucket's mint.
//!
//! Without it a bucket token is an unknown token everywhere it appears — no name, no ticker, no
//! image in wallets, explorers or DEX listings. The mint authority is the bucket PDA, and Metaplex
//! requires the mint authority to sign, so only this program can create the metadata account. The
//! update authority stays the bucket PDA for the same reason: nobody can rewrite a bucket's identity
//! except through this program.

use anchor_lang::prelude::*;
use anchor_spl::metadata::{
    create_metadata_accounts_v3, mpl_token_metadata::types::DataV2, update_metadata_accounts_v2, CreateMetadataAccountsV3, Metadata,
    UpdateMetadataAccountsV2,
};
use anchor_spl::token::Mint;

use crate::errors::VaultError;
use crate::state::*;

/// Metaplex's own limits on `DataV2`.
pub const MAX_METADATA_NAME: usize = 32;
pub const MAX_METADATA_SYMBOL: usize = 10;
pub const MAX_METADATA_URI: usize = 200;

/// Cuts a string to `max` **bytes** without splitting a UTF-8 character. Metaplex counts bytes, and
/// a bucket name may be up to 48 of them (`MAX_NAME_LEN`), so the name usually needs shortening.
fn truncate_bytes(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut end = max;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}

/// A bucket has a name but no ticker, so one is derived: the name's letters and digits, uppercased,
/// cut to Metaplex's 10 characters. "Tokenized SP500" becomes TOKENIZEDS. Names with nothing
/// alphanumeric in them (emoji, punctuation) fall back to BUCKET rather than an empty symbol.
///
/// Mirrored in the SDK as `deriveSymbol` so the backend can label a bucket without reading the
/// chain; `vault/sdk/test/metadata.test.ts` and the unit test below share the same cases.
pub fn derive_symbol(name: &str) -> String {
    let s: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(MAX_METADATA_SYMBOL)
        .collect::<String>()
        .to_uppercase();
    if s.is_empty() {
        "BUCKET".to_string()
    } else {
        s
    }
}

#[derive(Accounts)]
pub struct BucketMetadata<'info> {
    /// The bucket's creator, the program admin, or the keeper. Anyone else could point a bucket's
    /// metadata at a URI they control, which is how a token gets a scam image. The keeper is on the
    /// list so a metadata transaction that fails during publish can be retried without a human: it
    /// can already act for every bucket, and metadata moves no funds.
    pub authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(constraint = bucket.token_mint == bucket_mint.key() @ VaultError::Unauthorized)]
    pub bucket: Box<Account<'info, Bucket>>,
    pub bucket_mint: Box<Account<'info, Mint>>,
    /// CHECK: the metadata PDA for this mint, checked by seeds here and by Metaplex on the CPI.
    #[account(
        mut,
        seeds = [b"metadata", token_metadata_program.key().as_ref(), bucket_mint.key().as_ref()],
        bump,
        seeds::program = token_metadata_program.key(),
    )]
    pub metadata: UncheckedAccount<'info>,
    pub token_metadata_program: Program<'info, Metadata>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

impl<'info> BucketMetadata<'info> {
    fn authorize(&self) -> Result<()> {
        let who = self.authority.key();
        require!(
            who == self.bucket.creator || who == self.config.admin || who == self.config.keeper,
            VaultError::Unauthorized
        );
        Ok(())
    }

    fn data(&self, uri: String) -> DataV2 {
        DataV2 {
            name: truncate_bytes(&self.bucket.name, MAX_METADATA_NAME),
            symbol: derive_symbol(&self.bucket.name),
            uri,
            seller_fee_basis_points: 0,
            creators: None,
            collection: None,
            uses: None,
        }
    }
}

/// Creates the metadata account. `uri` serves the JSON document wallets read for the description
/// and image; the backend serves it per bucket, so a rename shows up without touching the chain.
pub fn create_token_metadata(ctx: Context<BucketMetadata>, uri: String) -> Result<()> {
    let a = &ctx.accounts;
    a.authorize()?;
    require!(!uri.trim().is_empty() && uri.len() <= MAX_METADATA_URI, VaultError::UriLength);

    let id = a.bucket.id.to_le_bytes();
    let seeds = bucket_seeds!(a.bucket, id);
    create_metadata_accounts_v3(
        CpiContext::new_with_signer(
            a.token_metadata_program.to_account_info(),
            CreateMetadataAccountsV3 {
                metadata: a.metadata.to_account_info(),
                mint: a.bucket_mint.to_account_info(),
                mint_authority: a.bucket.to_account_info(),
                payer: a.payer.to_account_info(),
                update_authority: a.bucket.to_account_info(),
                system_program: a.system_program.to_account_info(),
                rent: a.rent.to_account_info(),
            },
            &[seeds],
        ),
        a.data(uri),
        true,  // mutable: a creator may rename a bucket, and the name lives here too
        true,  // the update authority (the bucket PDA) signs
        None,
    )
}

/// Rewrites the metadata from the bucket's current name. Run after `update_bucket_info`, otherwise
/// wallets keep showing the old name.
pub fn update_token_metadata(ctx: Context<BucketMetadata>, uri: String) -> Result<()> {
    let a = &ctx.accounts;
    a.authorize()?;
    require!(!uri.trim().is_empty() && uri.len() <= MAX_METADATA_URI, VaultError::UriLength);

    let id = a.bucket.id.to_le_bytes();
    let seeds = bucket_seeds!(a.bucket, id);
    update_metadata_accounts_v2(
        CpiContext::new_with_signer(
            a.token_metadata_program.to_account_info(),
            UpdateMetadataAccountsV2 {
                metadata: a.metadata.to_account_info(),
                update_authority: a.bucket.to_account_info(),
            },
            &[seeds],
        ),
        None,
        Some(a.data(uri)),
        None,
        Some(true),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    // Shared with vault/sdk/test/metadata.test.ts — keep both in step.
    #[test]
    fn symbols_are_derived_from_the_name() {
        assert_eq!(derive_symbol("Tokenized SP500"), "TOKENIZEDS");
        assert_eq!(derive_symbol("FAANG"), "FAANG");
        assert_eq!(derive_symbol("AI & Robotics"), "AIROBOTICS");
        assert_eq!(derive_symbol("  spaced  out  "), "SPACEDOUT");
        assert_eq!(derive_symbol("2024 Winners"), "2024WINNER");
        assert_eq!(derive_symbol("🚀🚀🚀"), "BUCKET");
        assert_eq!(derive_symbol(""), "BUCKET");
    }

    #[test]
    fn names_are_cut_to_metaplex_length_on_a_character_boundary() {
        let long = "A".repeat(MAX_NAME_LEN);
        assert_eq!(truncate_bytes(&long, MAX_METADATA_NAME).len(), MAX_METADATA_NAME);
        assert_eq!(truncate_bytes("short", MAX_METADATA_NAME), "short");
        // 'é' is two bytes: cutting at 32 must not land inside it.
        let accented = "é".repeat(20);
        let cut = truncate_bytes(&accented, MAX_METADATA_NAME);
        assert!(cut.len() <= MAX_METADATA_NAME);
        assert_eq!(cut, "é".repeat(16));
    }
}
