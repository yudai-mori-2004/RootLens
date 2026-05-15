// SPDX-License-Identifier: Apache-2.0
//
// Config PDA を close し、rent を authority に戻す。
//
// 用途: 監査/テスト環境で root_nft_collection / usdc_mint を変更したいとき、
//       一旦 close → re-init で再 pin する経路。
//
// セキュリティ注意:
//   production では admin がこの命令で Config を閉じて再 init すれば実質
//   root_nft_collection をローテートできてしまう (immutability の bypass)。
//   よって本命令は audit/dev 用と位置付け、production ビルドでは
//   feature gate で外すことを推奨 (TODO: features = ["admin-mutable-config"])。

use anchor_lang::prelude::*;

use crate::state::Config;

#[derive(Accounts)]
pub struct CloseConfig<'info> {
    /// 受取 + signer。`has_one = authority` で config 内の値と一致確認
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [Config::SEED],
        bump = config.bump,
        has_one = authority,
        close = authority,
    )]
    pub config: Account<'info, Config>,
}

pub fn handler(ctx: Context<CloseConfig>) -> Result<()> {
    msg!(
        "license-nft: config closed by authority={}, rent returned",
        ctx.accounts.authority.key()
    );
    Ok(())
}
