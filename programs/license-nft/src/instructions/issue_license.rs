// SPDX-License-Identifier: Apache-2.0
//
// SPECS_JA §5.2 / §5.3 / §5.4 — License NFT 発行と収益分配。
//
// title-protocol が Bubblegum V2 (LeafSchema::V2 + MintV2 + MPL Core Collection)
// で Root NFT を発行するため、本プログラムも V2 で proof verify + License mint する。
//
// 検証順序 (fail-fast, fail-any-revert-all):
//   1. price > 0
//   2. Collection check: 引数 collection_pubkey == config.title_core_collection
//   3. LeafSchema::V2 を構築 (collection_hash は in-program で計算)
//   4. mpl_account_compression::verify_leaf で root_merkle_tree 上の在籍を検証
//      → owner / delegate / collection / data_hash / creator_hash がすべて一致
// 効果 (atomic):
//   1. License NFT を license_merkle_tree に buyer 宛にミント (MintV2 CPI)
//   2. buyer_usdc → pool_usdc へ staker_share 移転
//   3. buyer_usdc → delegate_usdc へ delegate_share 移転
//   4. user_revenue.balance += staker_share (checked_add)

use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Mint, Token, TokenAccount, Transfer};

use mpl_bubblegum::{
    hash::hash_collection_option,
    instructions::MintV2CpiBuilder,
    types::{Creator, LeafSchema, MetadataArgsV2, TokenStandard},
    utils::get_asset_id,
};

use crate::error::LicenseNftError;
use crate::state::{tree_authority, Config, UserRevenue};

#[derive(Accounts)]
pub struct IssueLicense<'info> {
    /// 購入者 (AI 企業)。USDC 出元 + tx 手数料 + UserRevenue init 費用
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// co-signer。Root NFT の delegate であることを Merkle proof で検証する。5% を受け取る。
    #[account(mut)]
    pub delegate: Signer<'info>,

    /// CHECK: Root NFT の owner (= ステーカー)。Merkle proof 内の owner field と一致確認するため
    /// このアカウントは signer ではない。staker.key() を leaf hash に取り込む。
    pub staker: UncheckedAccount<'info>,

    // SBF stack frame は 4096 bytes しかない。Anchor が生成する try_accounts の
    // ローカルフレームを抑えるため Account<'info, T> はすべて Box で heap に逃がす。
    #[account(
        seeds = [Config::SEED],
        bump = config.bump,
        has_one = usdc_mint @ LicenseNftError::UsdcMintMismatch,
    )]
    pub config: Box<Account<'info, Config>>,

    /// ステーカーの収益残高。初回 issue_license 時に buyer 負担で init
    #[account(
        init_if_needed,
        payer = buyer,
        space = 8 + UserRevenue::INIT_SPACE,
        seeds = [UserRevenue::SEED, staker.key().as_ref()],
        bump,
    )]
    pub user_revenue: Box<Account<'info, UserRevenue>>,

    pub usdc_mint: Box<Account<'info, Mint>>,

    /// 購入者の USDC ATA
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = buyer,
    )]
    pub buyer_usdc: Box<Account<'info, TokenAccount>>,

    /// delegate の USDC ATA (5% 即時送金先)
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = delegate,
    )]
    pub delegate_usdc: Box<Account<'info, TokenAccount>>,

    /// プログラム PDA が所有する USDC pool (95% 入金先)
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = config,
        constraint = pool_usdc.owner == config.key() @ LicenseNftError::InvalidPoolOwner,
    )]
    pub pool_usdc: Box<Account<'info, TokenAccount>>,

    // ----- Bubblegum V2 — Root NFT proof verify 用 ---------------------------
    /// CHECK: Root NFT が格納されている Bubblegum tree。
    /// mpl_account_compression::verify_leaf に渡す。
    pub root_merkle_tree: UncheckedAccount<'info>,

    // ----- Bubblegum V2 — License NFT mint 用 --------------------------------
    /// CHECK: License NFT を mint する Bubblegum tree (mut)。
    /// tree authority がプログラム PDA `license_tree_authority` になっている前提。
    #[account(mut)]
    pub license_merkle_tree: UncheckedAccount<'info>,

    /// CHECK: License tree の TreeConfig PDA (Bubblegum 派生)。
    /// derive_tree_config = find_program_address(&[merkle_tree], &mpl_bubblegum::ID)
    #[account(mut)]
    pub license_tree_config: UncheckedAccount<'info>,

    /// CHECK: License tree authority (このプログラムの PDA)。
    /// MintV2 の tree_creator_or_delegate に渡し、PDA seeds で sign する。
    #[account(
        seeds = [tree_authority::SEED, license_merkle_tree.key().as_ref()],
        bump,
    )]
    pub license_tree_authority: UncheckedAccount<'info>,

    /// CHECK: License MPL Core Collection。Config に焼き付けた値と一致確認。
    /// MintV2 の core_collection に渡し、collection_authority = config PDA で sign。
    #[account(
        mut,
        constraint = license_collection.key() == config.license_collection
            @ LicenseNftError::InvalidLicenseCollection,
    )]
    pub license_collection: UncheckedAccount<'info>,

    /// CHECK: MPL Core CPI signer PDA (mpl_bubblegum 派生)。
    /// derive: find_program_address(&[b"mpl_core_cpi_signer"], &mpl_bubblegum::ID)
    pub mpl_core_cpi_signer: UncheckedAccount<'info>,

    // ----- 共通 program / sysvar --------------------------------------------
    /// CHECK: mpl_account_compression program (Root proof verify + Bubblegum CPI 内部で使う)
    pub compression_program: UncheckedAccount<'info>,
    /// CHECK: mpl_bubblegum program
    pub bubblegum_program: UncheckedAccount<'info>,
    /// CHECK: spl-noop log wrapper (Bubblegum / spl-account-compression が event log に使う)
    pub log_wrapper: UncheckedAccount<'info>,
    /// CHECK: mpl_core program (Collection 連動 mint で必要)
    pub mpl_core_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, IssueLicense<'info>>,

    // ===== Root NFT proof args (Bubblegum V2) =====
    root: [u8; 32],
    nonce: u64,
    index: u32,
    data_hash: [u8; 32],
    creator_hash: [u8; 32],
    asset_data_hash: [u8; 32],
    flags: u8,
    // root_collection: Root NFT が紐づく MPL Core Collection (TitleCore)。
    // Option<Pubkey> ではなく必須 — Root NFT は常に TitleCore に属する前提
    root_collection: Pubkey,

    // ===== License NFT mint args =====
    license_metadata_uri: String,
    license_name: String,

    // ===== Pricing =====
    price: u64,
) -> Result<()> {
    require!(price > 0, LicenseNftError::InvalidPrice);

    // ----- 2. Collection check -----
    require!(
        root_collection == ctx.accounts.config.title_core_collection,
        LicenseNftError::InvalidCollection
    );
    let collection_hash = hash_collection_option(Some(root_collection))
        .map_err(|_| error!(LicenseNftError::InvalidCollection))?;

    // ----- 3. LeafSchema::V2 build + 4. Merkle proof verify -----
    let leaf = LeafSchema::V2 {
        id: get_asset_id(&ctx.accounts.root_merkle_tree.key(), nonce),
        owner: ctx.accounts.staker.key(),
        delegate: ctx.accounts.delegate.key(),
        nonce,
        data_hash,
        creator_hash,
        collection_hash,
        asset_data_hash,
        flags,
    };
    let leaf_hash = leaf.hash();

    let cpi_accounts = mpl_account_compression::cpi::accounts::VerifyLeaf {
        merkle_tree: ctx.accounts.root_merkle_tree.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.compression_program.to_account_info(),
        cpi_accounts,
    )
    .with_remaining_accounts(ctx.remaining_accounts.to_vec());
    mpl_account_compression::cpi::verify_leaf(cpi_ctx, root, leaf_hash, index)
        .map_err(|_| error!(LicenseNftError::InvalidLeafProof))?;

    // ----- 5. Split (basis points base 10000), 整数誤差はすべて delegate 側に乗せず staker 側に切り上げる方式
    // delegate_share = price - staker_share の順で計算 (1 unit ずれを吸収)
    let staker_share = (price as u128)
        .checked_mul(ctx.accounts.config.staker_basis_points as u128)
        .ok_or(LicenseNftError::SplitOverflow)?
        .checked_div(10_000u128)
        .ok_or(LicenseNftError::SplitOverflow)? as u64;
    let delegate_share = price
        .checked_sub(staker_share)
        .ok_or(LicenseNftError::SplitOverflow)?;

    // ----- 6. License NFT mint (Bubblegum MintV2 CPI, License Collection 連動) -----
    // SPECS §5.5.3 Layer 1 binding: 本来は MintV2 の asset_data に root_asset_id を
    // 渡して Bubblegum に keccak ハッシュさせるのが理想 (asset_data_hash 経由)。
    // しかし devnet 上の deployed mpl-bubblegum がまだ asset_data feature を
    // 受け付けない (NotAvailable error 6050) ため、代替として URI に root_asset_id を
    // クエリパラメータで append する方式を取る:
    //   final_uri = "<caller_uri>?root_mint=<root_asset_id_b58>"
    // この URI は MetadataArgsV2.uri に格納され、Bubblegum の data_hash → leaf hash の
    // 経路で sealed されるため、caller が後から root_mint を改ざんすることはできない。
    // 第三者は License NFT の URI を fetch する前に root_mint=... 部分をパースし、
    // 主張される Root NFT と照合することで Layer 1 binding を検証できる。
    // 将来 Bubblegum が asset_data を許可したら、この URI append は廃止して
    // asset_data_hash 経由の binding に切り替える。
    let root_asset_id = leaf.id();
    let separator = if license_metadata_uri.contains('?') { '&' } else { '?' };
    let final_uri = format!("{}{}root_mint={}", license_metadata_uri, separator, root_asset_id);

    let license_metadata = MetadataArgsV2 {
        name: license_name,
        symbol: "RLLIC".to_string(),
        // Layer 2 binding (SPECS §5.5.3): URL の path に license terms hash を含む
        // self-certifying URL を caller (delegate) が指定する。
        // 例: https://rootlens.io/licenses/commercial-v1/<terms_hash>.json
        // + Layer 1 binding: program が ?root_mint=<root_asset_id> を append
        uri: final_uri,
        seller_fee_basis_points: 0,
        primary_sale_happened: true,
        is_mutable: false,
        token_standard: Some(TokenStandard::NonFungible),
        creators: vec![Creator {
            address: ctx.accounts.delegate.key(),
            verified: false,
            share: 100,
        }],
        // License Collection を addressed (V2 では verified=true 自動)
        collection: Some(ctx.accounts.license_collection.key()),
    };

    let license_tree_authority_bump = ctx.bumps.license_tree_authority;
    let license_merkle_tree_key = ctx.accounts.license_merkle_tree.key();
    let config_bump = ctx.accounts.config.bump;

    // 2 つの PDA を別々の signer_seeds として CPI に渡す:
    //   1. license_tree_authority (Bubblegum tree authority として)
    //   2. config (License Collection の MPL Core update_authority として)
    let signer_seeds: &[&[&[u8]]] = &[
        &[
            tree_authority::SEED,
            license_merkle_tree_key.as_ref(),
            &[license_tree_authority_bump],
        ],
        &[Config::SEED, &[config_bump]],
    ];

    MintV2CpiBuilder::new(&ctx.accounts.bubblegum_program.to_account_info())
        .tree_config(&ctx.accounts.license_tree_config.to_account_info())
        .payer(&ctx.accounts.buyer.to_account_info())
        .tree_creator_or_delegate(Some(&ctx.accounts.license_tree_authority.to_account_info()))
        // ↓ License Collection の update_authority として Config PDA が sign
        .collection_authority(Some(&ctx.accounts.config.to_account_info()))
        .leaf_owner(&ctx.accounts.buyer.to_account_info())
        .leaf_delegate(None) // default = leaf_owner = buyer
        .merkle_tree(&ctx.accounts.license_merkle_tree.to_account_info())
        .core_collection(Some(&ctx.accounts.license_collection.to_account_info()))
        .mpl_core_cpi_signer(Some(&ctx.accounts.mpl_core_cpi_signer.to_account_info()))
        .log_wrapper(&ctx.accounts.log_wrapper.to_account_info())
        .compression_program(&ctx.accounts.compression_program.to_account_info())
        .mpl_core_program(&ctx.accounts.mpl_core_program.to_account_info())
        .system_program(&ctx.accounts.system_program.to_account_info())
        .metadata(license_metadata)
        .invoke_signed(signer_seeds)
        .map_err(|e| {
            msg!("license-nft: MintV2 CPI failed: {:?}", e);
            error!(LicenseNftError::InvalidLeafProof)
        })?;

    // ----- 7. USDC transfers -----
    if staker_share > 0 {
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.buyer_usdc.to_account_info(),
                to: ctx.accounts.pool_usdc.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        );
        transfer(cpi_ctx, staker_share)?;
    }
    if delegate_share > 0 {
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.buyer_usdc.to_account_info(),
                to: ctx.accounts.delegate_usdc.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        );
        transfer(cpi_ctx, delegate_share)?;
    }

    // ----- 8. UserRevenue 累積 -----
    let revenue = &mut ctx.accounts.user_revenue;
    if revenue.user == Pubkey::default() {
        revenue.user = ctx.accounts.staker.key();
        revenue.bump = ctx.bumps.user_revenue;
    } else {
        require!(
            revenue.user == ctx.accounts.staker.key(),
            LicenseNftError::UserMismatch
        );
    }
    revenue.balance = revenue
        .balance
        .checked_add(staker_share)
        .ok_or(LicenseNftError::BalanceOverflow)?;

    msg!(
        "license-nft: issue_license root={} index={} price={} staker_share={} delegate_share={} staker={}",
        ctx.accounts.root_merkle_tree.key(),
        index,
        price,
        staker_share,
        delegate_share,
        ctx.accounts.staker.key()
    );
    Ok(())
}
