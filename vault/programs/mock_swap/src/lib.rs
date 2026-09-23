//! Devnet swap venue for Bucket.
//!
//! xStocks, PreStocks and Tessera tokens exist on mainnet only, so the devnet
//! preview runs on mock Token-2022 mints whose prices mirror mainnet. This
//! program is the "DEX" for them: one `Market` per mock stock, quoted at a
//! pushed price with a fee. It holds mint authority over the mock stocks and
//! mock USDC, so liquidity is unlimited. Stock leaves and enters through
//! `transfer_checked`, so Token-2022 transfer fees apply exactly as they would
//! on a real venue.
//!
//! Never deploy this to mainnet.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Burn, Mint, MintTo, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("AJGUpUhoiae8c3Kyu9Gk4j8f8E7mpyiMqPSf2w3FNRyx");

pub const STATE_SEED: &[u8] = b"state";
pub const MARKET_SEED: &[u8] = b"market";
pub const AUTHORITY_SEED: &[u8] = b"mint_authority";
/// Largest faucet drip per call: $10,000 of mock USDC.
pub const FAUCET_CAP: u64 = 10_000_000_000;

#[program]
pub mod mock_swap {
    use super::*;

    pub fn init_state(ctx: Context<InitState>, price_authority: Pubkey) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.admin = ctx.accounts.admin.key();
        state.price_authority = price_authority;
        state.usdc_mint = ctx.accounts.usdc_mint.key();
        state.bump = ctx.bumps.state;
        state.authority_bump = ctx.bumps.mint_authority;
        Ok(())
    }

    pub fn create_market(ctx: Context<CreateMarket>, price_e6: u64, fee_bps: u16) -> Result<()> {
        require!(price_e6 > 0, MockSwapError::ZeroPrice);
        require!(fee_bps <= 1_000, MockSwapError::FeeTooHigh);
        let market = &mut ctx.accounts.market;
        market.stock_mint = ctx.accounts.stock_mint.key();
        market.price_e6 = price_e6;
        market.fee_bps = fee_bps;
        market.bump = ctx.bumps.market;
        Ok(())
    }

    pub fn set_price(ctx: Context<SetPrice>, price_e6: u64) -> Result<()> {
        require!(price_e6 > 0, MockSwapError::ZeroPrice);
        ctx.accounts.market.price_e6 = price_e6;
        Ok(())
    }

    /// `buy = true`: USDC in, stock out. `buy = false`: stock in, USDC out.
    /// `user` only has to be the token authority of `source`; it can be a PDA
    /// signing through CPI, which is how the Bucket vault calls it.
    pub fn swap(ctx: Context<Swap>, amount_in: u64, min_out: u64, buy: bool) -> Result<()> {
        require!(amount_in > 0, MockSwapError::ZeroAmount);
        let a = &ctx.accounts;
        let market = &a.market;
        let fee_keep = 10_000u128 - market.fee_bps as u128;
        let scale = 10u128.pow(a.stock_mint.decimals as u32);
        let authority_seeds: &[&[u8]] = &[AUTHORITY_SEED, &[a.state.authority_bump]];

        let out = if buy {
            require_keys_eq!(a.source.mint, a.usdc_mint.key(), MockSwapError::WrongMint);
            require_keys_eq!(a.destination.mint, a.stock_mint.key(), MockSwapError::WrongMint);
            token_interface::burn(
                CpiContext::new(
                    a.usdc_token_program.to_account_info(),
                    Burn {
                        mint: a.usdc_mint.to_account_info(),
                        from: a.source.to_account_info(),
                        authority: a.user.to_account_info(),
                    },
                ),
                amount_in,
            )?;
            let qty = (amount_in as u128 * fee_keep / 10_000 * scale / market.price_e6 as u128) as u64;
            require!(qty > 0, MockSwapError::ZeroAmount);
            if a.inventory.amount < qty {
                token_interface::mint_to(
                    CpiContext::new_with_signer(
                        a.stock_token_program.to_account_info(),
                        MintTo {
                            mint: a.stock_mint.to_account_info(),
                            to: a.inventory.to_account_info(),
                            authority: a.mint_authority.to_account_info(),
                        },
                        &[authority_seeds],
                    ),
                    qty.saturating_mul(2),
                )?;
            }
            let before = a.destination.amount;
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    a.stock_token_program.to_account_info(),
                    TransferChecked {
                        from: a.inventory.to_account_info(),
                        mint: a.stock_mint.to_account_info(),
                        to: a.destination.to_account_info(),
                        authority: a.mint_authority.to_account_info(),
                    },
                    &[authority_seeds],
                ),
                qty,
                a.stock_mint.decimals,
            )?;
            let mut dest = a.destination.clone();
            dest.reload()?;
            dest.amount - before
        } else {
            require_keys_eq!(a.source.mint, a.stock_mint.key(), MockSwapError::WrongMint);
            require_keys_eq!(a.destination.mint, a.usdc_mint.key(), MockSwapError::WrongMint);
            let before = a.inventory.amount;
            token_interface::transfer_checked(
                CpiContext::new(
                    a.stock_token_program.to_account_info(),
                    TransferChecked {
                        from: a.source.to_account_info(),
                        mint: a.stock_mint.to_account_info(),
                        to: a.inventory.to_account_info(),
                        authority: a.user.to_account_info(),
                    },
                ),
                amount_in,
                a.stock_mint.decimals,
            )?;
            let mut inv = a.inventory.clone();
            inv.reload()?;
            let received = (inv.amount - before) as u128;
            let usdc = (received * market.price_e6 as u128 / scale * fee_keep / 10_000) as u64;
            require!(usdc > 0, MockSwapError::ZeroAmount);
            token_interface::mint_to(
                CpiContext::new_with_signer(
                    a.usdc_token_program.to_account_info(),
                    MintTo {
                        mint: a.usdc_mint.to_account_info(),
                        to: a.destination.to_account_info(),
                        authority: a.mint_authority.to_account_info(),
                    },
                    &[authority_seeds],
                ),
                usdc,
            )?;
            usdc
        };
        require!(out >= min_out, MockSwapError::SlippageExceeded);
        emit!(Swapped { market: market.key(), buy, amount_in, amount_out: out });
        Ok(())
    }

    /// Stock A in, stock B out at the two market prices, charging both fees.
    /// Used by vault rebalances on devnet.
    pub fn swap_stocks(ctx: Context<SwapStocks>, amount_in: u64, min_out: u64) -> Result<()> {
        require!(amount_in > 0, MockSwapError::ZeroAmount);
        let a = &ctx.accounts;
        let authority_seeds: &[&[u8]] = &[AUTHORITY_SEED, &[a.state.authority_bump]];
        let before = a.inventory_in.amount;
        token_interface::transfer_checked(
            CpiContext::new(
                a.token_program_in.to_account_info(),
                TransferChecked {
                    from: a.source.to_account_info(),
                    mint: a.mint_in.to_account_info(),
                    to: a.inventory_in.to_account_info(),
                    authority: a.user.to_account_info(),
                },
            ),
            amount_in,
            a.mint_in.decimals,
        )?;
        let mut inv = a.inventory_in.clone();
        inv.reload()?;
        let received = (inv.amount - before) as u128;
        let usd = received * a.market_in.price_e6 as u128 / 10u128.pow(a.mint_in.decimals as u32);
        let keep = (10_000 - a.market_in.fee_bps as u128) * (10_000 - a.market_out.fee_bps as u128);
        let qty = (usd * keep / 100_000_000 * 10u128.pow(a.mint_out.decimals as u32) / a.market_out.price_e6 as u128) as u64;
        require!(qty > 0, MockSwapError::ZeroAmount);
        if a.inventory_out.amount < qty {
            token_interface::mint_to(
                CpiContext::new_with_signer(
                    a.token_program_out.to_account_info(),
                    MintTo {
                        mint: a.mint_out.to_account_info(),
                        to: a.inventory_out.to_account_info(),
                        authority: a.mint_authority.to_account_info(),
                    },
                    &[authority_seeds],
                ),
                qty.saturating_mul(2),
            )?;
        }
        let dest_before = a.destination.amount;
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                a.token_program_out.to_account_info(),
                TransferChecked {
                    from: a.inventory_out.to_account_info(),
                    mint: a.mint_out.to_account_info(),
                    to: a.destination.to_account_info(),
                    authority: a.mint_authority.to_account_info(),
                },
                &[authority_seeds],
            ),
            qty,
            a.mint_out.decimals,
        )?;
        let mut dest = a.destination.clone();
        dest.reload()?;
        let out = dest.amount - dest_before;
        require!(out >= min_out, MockSwapError::SlippageExceeded);
        emit!(Swapped { market: a.market_out.key(), buy: true, amount_in, amount_out: out });
        Ok(())
    }

    /// Devnet testers top up mock USDC here.
    pub fn faucet(ctx: Context<Faucet>, amount: u64) -> Result<()> {
        require!(amount > 0 && amount <= FAUCET_CAP, MockSwapError::FaucetCap);
        token_interface::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: ctx.accounts.mint_authority.to_account_info(),
                },
                &[&[AUTHORITY_SEED, &[ctx.accounts.state.authority_bump]]],
            ),
            amount,
        )
    }
}

#[account]
#[derive(InitSpace)]
pub struct State {
    pub admin: Pubkey,
    pub price_authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub bump: u8,
    pub authority_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub stock_mint: Pubkey,
    pub price_e6: u64,
    pub fee_bps: u16,
    pub bump: u8,
}

#[event]
pub struct Swapped {
    pub market: Pubkey,
    pub buy: bool,
    pub amount_in: u64,
    pub amount_out: u64,
}

#[derive(Accounts)]
pub struct InitState<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + State::INIT_SPACE, seeds = [STATE_SEED], bump)]
    pub state: Account<'info, State>,
    /// CHECK: PDA that is mint authority of every mock mint.
    #[account(seeds = [AUTHORITY_SEED], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    #[account(mint::authority = mint_authority)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateMarket<'info> {
    #[account(mut, address = state.admin)]
    pub admin: Signer<'info>,
    #[account(seeds = [STATE_SEED], bump = state.bump)]
    pub state: Account<'info, State>,
    /// CHECK: PDA mint authority.
    #[account(seeds = [AUTHORITY_SEED], bump = state.authority_bump)]
    pub mint_authority: UncheckedAccount<'info>,
    #[account(mint::authority = mint_authority)]
    pub stock_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init, payer = admin, space = 8 + Market::INIT_SPACE,
        seeds = [MARKET_SEED, stock_mint.key().as_ref()], bump
    )]
    pub market: Account<'info, Market>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetPrice<'info> {
    #[account(constraint = signer.key() == state.price_authority || signer.key() == state.admin @ MockSwapError::Unauthorized)]
    pub signer: Signer<'info>,
    #[account(seeds = [STATE_SEED], bump = state.bump)]
    pub state: Account<'info, State>,
    #[account(mut, seeds = [MARKET_SEED, market.stock_mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    pub user: Signer<'info>,
    #[account(seeds = [STATE_SEED], bump = state.bump)]
    pub state: Box<Account<'info, State>>,
    #[account(seeds = [MARKET_SEED, stock_mint.key().as_ref()], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,
    /// CHECK: PDA mint authority; signs mints and inventory transfers.
    #[account(seeds = [AUTHORITY_SEED], bump = state.authority_bump)]
    pub mint_authority: UncheckedAccount<'info>,
    #[account(mut, address = state.usdc_mint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, mint::token_program = stock_token_program)]
    pub stock_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = stock_mint,
        associated_token::authority = mint_authority,
        associated_token::token_program = stock_token_program,
    )]
    pub inventory: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::authority = user)]
    pub source: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
    pub stock_token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct SwapStocks<'info> {
    pub user: Signer<'info>,
    #[account(seeds = [STATE_SEED], bump = state.bump)]
    pub state: Box<Account<'info, State>>,
    #[account(seeds = [MARKET_SEED, mint_in.key().as_ref()], bump = market_in.bump)]
    pub market_in: Box<Account<'info, Market>>,
    #[account(seeds = [MARKET_SEED, mint_out.key().as_ref()], bump = market_out.bump)]
    pub market_out: Box<Account<'info, Market>>,
    /// CHECK: PDA mint authority; signs mints and inventory transfers.
    #[account(seeds = [AUTHORITY_SEED], bump = state.authority_bump)]
    pub mint_authority: UncheckedAccount<'info>,
    #[account(mint::token_program = token_program_in)]
    pub mint_in: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, mint::token_program = token_program_out)]
    pub mint_out: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = mint_in,
        associated_token::authority = mint_authority,
        associated_token::token_program = token_program_in,
    )]
    pub inventory_in: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = mint_out,
        associated_token::authority = mint_authority,
        associated_token::token_program = token_program_out,
    )]
    pub inventory_out: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = mint_in, token::authority = user)]
    pub source: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = mint_out)]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program_in: Interface<'info, TokenInterface>,
    pub token_program_out: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Faucet<'info> {
    #[account(seeds = [STATE_SEED], bump = state.bump)]
    pub state: Account<'info, State>,
    /// CHECK: PDA mint authority.
    #[account(seeds = [AUTHORITY_SEED], bump = state.authority_bump)]
    pub mint_authority: UncheckedAccount<'info>,
    #[account(mut, address = state.usdc_mint)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = usdc_mint)]
    pub destination: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[error_code]
pub enum MockSwapError {
    #[msg("Price must be positive")]
    ZeroPrice,
    #[msg("Fee above 10%")]
    FeeTooHigh,
    #[msg("Amount must be positive")]
    ZeroAmount,
    #[msg("Wrong mint for this side of the swap")]
    WrongMint,
    #[msg("Output below minimum")]
    SlippageExceeded,
    #[msg("Faucet amount above cap")]
    FaucetCap,
    #[msg("Not allowed")]
    Unauthorized,
}
