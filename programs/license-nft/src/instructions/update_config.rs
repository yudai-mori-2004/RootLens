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
/// root_nft_collection / usdc_mint は本当の意味で「変更不能」 ではない (= authority
/// が rotate 出来るので、 admin は事実上何でも書き換えられる)。 mainnet 運用で意図的
/// に lock したい場合は、 デプロイ後に authority を null pubkey や multisig へ移し、
/// program upgrade authority も同様にロックする運用で防ぐ。 ここではプログラム側で
/// 過剰に縛らず、 dev / staging で TP 切替や test collection 差し替えが出来るように
/// しておく。
pub fn handler(
    ctx: Context<UpdateConfig>,
    new_authority: Option<Pubkey>,
    new_staker_basis_points: Option<u16>,
    new_delegate_basis_points: Option<u16>,
    new_root_nft_collection: Option<Pubkey>,
    new_usdc_mint: Option<Pubkey>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;

    if let Some(a) = new_authority {
        config.authority = a;
    }
    if let Some(c) = new_root_nft_collection {
        config.root_nft_collection = c;
    }
    if let Some(m) = new_usdc_mint {
        config.usdc_mint = m;
    }

    let next_staker = new_staker_basis_points.unwrap_or(config.staker_basis_points);
    let next_delegate = new_delegate_basis_points.unwrap_or(config.delegate_basis_points);
    Config::validate_split(next_staker, next_delegate)?;
    config.staker_basis_points = next_staker;
    config.delegate_basis_points = next_delegate;

    msg!(
        "license-nft: config updated — root_nft_collection={} usdc_mint={} staker={}bps delegate={}bps authority={}",
        config.root_nft_collection,
        config.usdc_mint,
        config.staker_basis_points,
        config.delegate_basis_points,
        config.authority
    );
    Ok(())
}
