// SPDX-License-Identifier: Apache-2.0
//
// License Bubblegum tree を本プログラム所有 PDA を tree_creator にして作成する。
// 後の issue_license で MintV2 を CPI signed する際、tree_creator_or_delegate=PDA で sign 可能。
//
// CPI 先: mpl_bubblegum::instructions::CreateTreeConfigV2

use anchor_lang::prelude::*;
use mpl_bubblegum::instructions::CreateTreeConfigV2CpiBuilder;

use crate::state::tree_authority;

#[derive(Accounts)]
pub struct CreateLicenseTree<'info> {
    /// rent payer (admin or anyone)
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: 新規 Bubblegum merkle tree (writable)。
    /// 呼出側が ConcurrentMerkleTreeAccount のスペースを事前に allocate する必要あり (createAccount ix を tx 内で先に呼ぶ)
    #[account(mut)]
    pub merkle_tree: UncheckedAccount<'info>,

    /// CHECK: Bubblegum tree config PDA (Bubblegum 派生)
    #[account(mut)]
    pub tree_config: UncheckedAccount<'info>,

    /// CHECK: tree_creator_or_delegate になる PDA (license_tree_authority)。
    /// 本 ix で seeds 付き sign を行う。
    #[account(
        seeds = [tree_authority::SEED, merkle_tree.key().as_ref()],
        bump,
    )]
    pub license_tree_authority: UncheckedAccount<'info>,

    /// CHECK: mpl_account_compression program (Bubblegum V2 が使う mcmt6Y...)
    pub compression_program: UncheckedAccount<'info>,
    /// CHECK: mpl_bubblegum program
    pub bubblegum_program: UncheckedAccount<'info>,
    /// CHECK: mpl_noop log wrapper (V2 用 mnoopT...)
    pub log_wrapper: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreateLicenseTree>, max_depth: u32, max_buffer_size: u32) -> Result<()> {
    let bump = ctx.bumps.license_tree_authority;
    let merkle_tree_key = ctx.accounts.merkle_tree.key();
    let signer_seeds: &[&[&[u8]]] = &[&[
        tree_authority::SEED,
        merkle_tree_key.as_ref(),
        &[bump],
    ]];

    CreateTreeConfigV2CpiBuilder::new(&ctx.accounts.bubblegum_program.to_account_info())
        .tree_config(&ctx.accounts.tree_config.to_account_info())
        .merkle_tree(&ctx.accounts.merkle_tree.to_account_info())
        .payer(&ctx.accounts.payer.to_account_info())
        .tree_creator(Some(&ctx.accounts.license_tree_authority.to_account_info()))
        .log_wrapper(&ctx.accounts.log_wrapper.to_account_info())
        .compression_program(&ctx.accounts.compression_program.to_account_info())
        .system_program(&ctx.accounts.system_program.to_account_info())
        .max_depth(max_depth)
        .max_buffer_size(max_buffer_size)
        .public(false)
        .invoke_signed(signer_seeds)
        .map_err(|e| {
            msg!("create_license_tree CPI failed: {:?}", e);
            error!(crate::error::LicenseNftError::InvalidLeafProof)
        })?;
    msg!(
        "license-nft: license tree {} created (depth={} buf={})",
        merkle_tree_key,
        max_depth,
        max_buffer_size
    );
    Ok(())
}
