// SPDX-License-Identifier: Apache-2.0

use anchor_lang::prelude::*;

/// Global config — admin が初期化、Collection / USDC mint / 分配比率を pin する
///
/// SPECS §5.4.1 / §5.4.2 に対応。分配比率はオンチェーンで第三者検証可能。
///
/// trust model:
///   - title_core_collection: TP TEE が発行した Root NFT の正当性を MPL Core Collection で保証
///   - license_collection:    本プログラム発行の License NFT の正当性を保証。
///                            update_authority は **本 Config PDA**。
///                            admin keypair が漏洩しても License Collection に偽 mint 不可
///                            (= TP より trust 強い、delegate plugin 不要)
#[account]
#[derive(InitSpace)]
pub struct Config {
    /// admin (update_config / authority 移譲のみ可能。Collection 操作はできない)
    pub authority: Pubkey,
    /// TitleCore MPL Core Collection (Root NFT の collection)。issue_license の collection check で参照
    pub title_core_collection: Pubkey,
    /// License MPL Core Collection (本プログラム発行 License NFT の collection)。
    /// update_authority = この Config PDA。MintV2 の collection_authority に PDA seeds で sign
    pub license_collection: Pubkey,
    /// 受け払い通貨 (devnet では mock USDC mint)
    pub usdc_mint: Pubkey,
    /// ステーカー分配比率 (basis points, 10000 = 100%)。初期 9500
    pub staker_basis_points: u16,
    /// delegate 分配比率 (basis points)。初期 500
    pub delegate_basis_points: u16,
    /// PDA bump
    pub bump: u8,
}

impl Config {
    pub const SEED: &'static [u8] = b"config";

    /// staker_bps + delegate_bps == 10000 を保証する
    pub fn validate_split(staker_bps: u16, delegate_bps: u16) -> Result<()> {
        require!(
            staker_bps as u32 + delegate_bps as u32 == 10000,
            crate::error::LicenseNftError::InvalidBasisPoints
        );
        Ok(())
    }
}

/// ステーカーの未分配 USDC 残高
///
/// SPECS §5.4.1: ユーザー 1 人につき 1 個の PDA。初回 issue_license 時に
/// 購入者 (AI 企業) の手数料負担で init される。
#[account]
#[derive(InitSpace)]
pub struct UserRevenue {
    /// staker のウォレット (PDA seed と同じはずだが、改ざん検知用に保存)
    pub user: Pubkey,
    /// 未分配 USDC 残高 (USDC は 6 decimals なので u64 で 18 京 USDC まで OK)
    pub balance: u64,
    /// PDA bump
    pub bump: u8,
}

impl UserRevenue {
    pub const SEED: &'static [u8] = b"revenue";
}

/// License NFT の Bubblegum tree authority PDA。
///
/// この PDA を tree authority として持つことで、License NFT の mint が
/// このプログラム経由でしか発生しないことを保証する。
pub mod tree_authority {
    pub const SEED: &[u8] = b"tree_authority";
}
