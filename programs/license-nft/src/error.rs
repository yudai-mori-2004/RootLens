// SPDX-License-Identifier: Apache-2.0

use anchor_lang::prelude::*;

#[error_code]
pub enum LicenseNftError {
    #[msg("basis_points 合計は 10000 でなければならない")]
    InvalidBasisPoints,
    #[msg("price は 0 より大きくなければならない")]
    InvalidPrice,
    #[msg("root_nft_collection / usdc_mint は init 後に変更できない")]
    ImmutableConfigField,
    #[msg("UserRevenue PDA の user フィールドが signer と一致しない")]
    UserMismatch,
    #[msg("Bubblegum leaf の data_hash が再構築された値と一致しない")]
    DataHashMismatch,
    #[msg("Root NFT が指定された Root NFT コレクションに verified=true で属していない")]
    InvalidCollection,
    #[msg("license_collection アカウントが Config の license_collection と一致しない")]
    InvalidLicenseCollection,
    #[msg("Bubblegum proof verify に失敗した")]
    InvalidLeafProof,
    #[msg("usdc_mint アカウントが Config の usdc_mint と一致しない")]
    UsdcMintMismatch,
    #[msg("USDC pool token account の owner が Config PDA でない")]
    InvalidPoolOwner,
    #[msg("revenue 残高の累積で u64 overflow")]
    BalanceOverflow,
    #[msg("split で u64 overflow / underflow")]
    SplitOverflow,
}
