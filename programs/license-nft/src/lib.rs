// SPDX-License-Identifier: Apache-2.0

//! # RootLens License NFT Anchor program
//!
//! 仕様書: `document/v0.1.2/SPECS_JA.md` §5
//! ユニット doc: `document/v0.1.2/tasks/06-license-nft-program/README.md`
//!
//! ## 命令
//! - `initialize_config`: Config PDA を初期化 (admin)
//! - `update_config`: 分配比率 / authority を更新 (admin)
//! - `issue_license`: buyer + delegate co-sign で License NFT 発行 + USDC 95:5 分配
//! - `claim_revenue`: ステーカーが UserRevenue.balance を一括引き出し

use anchor_lang::prelude::*;

pub mod error;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("G1PWd1nMe63isDaYT3iijcyWac9d4RE1CBrvaKZFjpV8");

#[program]
pub mod license_nft {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        title_core_collection: Pubkey,
        license_collection: Pubkey,
        usdc_mint: Pubkey,
        staker_basis_points: u16,
        delegate_basis_points: u16,
    ) -> Result<()> {
        instructions::initialize_config::handler(
            ctx,
            title_core_collection,
            license_collection,
            usdc_mint,
            staker_basis_points,
            delegate_basis_points,
        )
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        new_authority: Option<Pubkey>,
        new_staker_basis_points: Option<u16>,
        new_delegate_basis_points: Option<u16>,
    ) -> Result<()> {
        instructions::update_config::handler(
            ctx,
            new_authority,
            new_staker_basis_points,
            new_delegate_basis_points,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn issue_license<'info>(
        ctx: Context<'_, '_, '_, 'info, IssueLicense<'info>>,

        // Root NFT proof args (Bubblegum V2)
        root: [u8; 32],
        nonce: u64,
        index: u32,
        data_hash: [u8; 32],
        creator_hash: [u8; 32],
        asset_data_hash: [u8; 32],
        flags: u8,
        root_collection: Pubkey,

        // License NFT mint args
        license_metadata_uri: String,
        license_name: String,

        // Pricing
        price: u64,
    ) -> Result<()> {
        instructions::issue_license::handler(
            ctx,
            root,
            nonce,
            index,
            data_hash,
            creator_hash,
            asset_data_hash,
            flags,
            root_collection,
            license_metadata_uri,
            license_name,
            price,
        )
    }

    pub fn claim_revenue(ctx: Context<ClaimRevenue>) -> Result<()> {
        instructions::claim_revenue::handler(ctx)
    }

    pub fn close_config(ctx: Context<CloseConfig>) -> Result<()> {
        instructions::close_config::handler(ctx)
    }

    pub fn create_license_tree(
        ctx: Context<CreateLicenseTree>,
        max_depth: u32,
        max_buffer_size: u32,
    ) -> Result<()> {
        instructions::create_license_tree::handler(ctx, max_depth, max_buffer_size)
    }
}
