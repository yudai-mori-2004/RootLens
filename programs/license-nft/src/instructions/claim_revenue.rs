// SPDX-License-Identifier: Apache-2.0

use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Mint, Token, TokenAccount, Transfer};

use crate::error::LicenseNftError;
use crate::state::{Config, UserRevenue};

#[derive(Accounts)]
pub struct ClaimRevenue<'info> {
    /// 引出主 (ステーカー本人)
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [Config::SEED],
        bump = config.bump,
        has_one = usdc_mint,
    )]
    pub config: Account<'info, Config>,

    /// 残高アカウント。seeds=[b"revenue", user] で user 本人にしかアクセスできない
    #[account(
        mut,
        seeds = [UserRevenue::SEED, user.key().as_ref()],
        bump = user_revenue.bump,
        has_one = user @ LicenseNftError::UserMismatch,
    )]
    pub user_revenue: Account<'info, UserRevenue>,

    /// USDC mint (Config と一致確認済み by has_one)
    pub usdc_mint: Account<'info, Mint>,

    /// プログラム PDA が所有する USDC pool。出金の signer は config PDA
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = config,
        constraint = pool_usdc.owner == config.key() @ LicenseNftError::InvalidPoolOwner,
    )]
    pub pool_usdc: Account<'info, TokenAccount>,

    /// ユーザーの USDC ATA (受取先)
    #[account(
        mut,
        token::mint = usdc_mint,
    )]
    pub user_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ClaimRevenue>) -> Result<()> {
    let amount = ctx.accounts.user_revenue.balance;

    if amount == 0 {
        msg!("license-nft: claim_revenue no-op (balance=0)");
        return Ok(());
    }

    // balance を 0 に reset してから transfer する (CEI パターン)
    ctx.accounts.user_revenue.balance = 0;

    let bump = ctx.accounts.config.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[Config::SEED, &[bump]]];

    let cpi_accounts = Transfer {
        from: ctx.accounts.pool_usdc.to_account_info(),
        to: ctx.accounts.user_usdc.to_account_info(),
        authority: ctx.accounts.config.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    transfer(cpi_ctx, amount)?;

    msg!(
        "license-nft: claim_revenue user={} amount={} USDC",
        ctx.accounts.user.key(),
        amount
    );
    Ok(())
}
