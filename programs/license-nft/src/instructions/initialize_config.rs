// SPDX-License-Identifier: Apache-2.0

use anchor_lang::prelude::*;

use crate::error::LicenseNftError;
use crate::state::Config;

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    /// admin (rent payer + 永続的な authority)
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Config PDA, seeds=[b"config"]
    #[account(
        init,
        payer = authority,
        space = 8 + Config::INIT_SPACE,
        seeds = [Config::SEED],
        bump,
    )]
    pub config: Account<'info, Config>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeConfig>,
    title_core_collection: Pubkey,
    license_collection: Pubkey,
    usdc_mint: Pubkey,
    staker_basis_points: u16,
    delegate_basis_points: u16,
) -> Result<()> {
    Config::validate_split(staker_basis_points, delegate_basis_points)?;

    // disallow null pubkey for safety (admin が間違えて Pubkey::default() を渡すケース)
    require!(
        title_core_collection != Pubkey::default(),
        LicenseNftError::InvalidCollection
    );
    require!(
        license_collection != Pubkey::default(),
        LicenseNftError::InvalidLicenseCollection
    );
    require!(
        usdc_mint != Pubkey::default(),
        LicenseNftError::UsdcMintMismatch
    );

    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.title_core_collection = title_core_collection;
    config.license_collection = license_collection;
    config.usdc_mint = usdc_mint;
    config.staker_basis_points = staker_basis_points;
    config.delegate_basis_points = delegate_basis_points;
    config.bump = ctx.bumps.config;

    msg!(
        "license-nft: config initialized — staker={}bps delegate={}bps title_core={} license={}",
        staker_basis_points,
        delegate_basis_points,
        title_core_collection,
        license_collection,
    );
    Ok(())
}
