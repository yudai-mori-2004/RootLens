// SPDX-License-Identifier: Apache-2.0

use anchor_lang::prelude::*;

use crate::state::Config;

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    /// 既存の Config.authority と一致する signer のみが更新可能
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [Config::SEED],
        bump = config.bump,
        has_one = authority,
    )]
    pub config: Account<'info, Config>,
}

/// すべて Option<...> で渡し、Some の項目だけ更新する。
///
/// title_core_collection と usdc_mint は init 後変更不可 (誤って差し替えると
/// 既発行の License NFT の意味が変わるため)。本命令ではそもそも引数に持たない。
pub fn handler(
    ctx: Context<UpdateConfig>,
    new_authority: Option<Pubkey>,
    new_staker_basis_points: Option<u16>,
    new_delegate_basis_points: Option<u16>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;

    if let Some(a) = new_authority {
        config.authority = a;
    }

    let next_staker = new_staker_basis_points.unwrap_or(config.staker_basis_points);
    let next_delegate = new_delegate_basis_points.unwrap_or(config.delegate_basis_points);
    Config::validate_split(next_staker, next_delegate)?;
    config.staker_basis_points = next_staker;
    config.delegate_basis_points = next_delegate;

    msg!(
        "license-nft: config updated — staker={}bps delegate={}bps authority={}",
        config.staker_basis_points,
        config.delegate_basis_points,
        config.authority
    );
    Ok(())
}
