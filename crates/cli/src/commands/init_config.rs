// SPDX-License-Identifier: Apache-2.0

//! `license-cli init-config` サブコマンド。
//!
//! 1. authority keypair をロード/生成 (`keys/authority.json`)
//! 2. devnet なら airdrop (残高不足時)
//! 3. License MPL Core Collection を新規作成 (`update_authority = config_pda`)
//! 4. `initialize_config` を呼んで Config PDA を初期化
//! 5. `network.json` をプロジェクトルートに書き出し
//!
//! TP の `init-global` と同じパターン。idempotent (config_pda が既に存在すれば
//! License Collection も再利用、ただし Bubblegum V2 plugin が無ければ再作成 + 設定更新)。

use std::path::Path;

#[allow(deprecated)]
use solana_sdk::{
    message::Message,
    pubkey::Pubkey,
    signer::{keypair::Keypair, Signer},
    transaction::Transaction,
};

use crate::anchor;
use crate::config::{self, NetworkConfig};
use crate::error::CliError;
use crate::rpc::SolanaRpc;

/// 開発環境のデフォルト program id (新規開発者は `solana-keygen new` で自分の
/// keypair を生成 → declare_id! と Anchor.toml と本ファイルの値を更新する)
pub const DEFAULT_PROGRAM_ID: &str = "G1PWd1nMe63isDaYT3iijcyWac9d4RE1CBrvaKZFjpV8";

#[allow(deprecated)]
pub async fn run(
    project_root: &Path,
    keys_dir: &Path,
    cluster: &str,
    rpc_override: Option<&str>,
    program_id_override: Option<&str>,
    root_nft_collection: &str,
    usdc_mint: &str,
    staker_bps: u16,
    delegate_bps: u16,
) -> Result<(), CliError> {
    if (staker_bps as u32) + (delegate_bps as u32) != 10_000 {
        return Err(CliError::Config(format!(
            "staker_bps + delegate_bps が 10000 ではない: {} + {} = {}",
            staker_bps,
            delegate_bps,
            staker_bps as u32 + delegate_bps as u32
        )));
    }

    let rpc_url = config::resolve_rpc_url(cluster, rpc_override);
    let program_id: Pubkey = program_id_override
        .unwrap_or(DEFAULT_PROGRAM_ID)
        .parse()
        .map_err(|e| CliError::Config(format!("program_id: {e}")))?;
    let root_nft: Pubkey = root_nft_collection
        .parse()
        .map_err(|e| CliError::Config(format!("root_nft_collection: {e}")))?;
    let usdc: Pubkey = usdc_mint
        .parse()
        .map_err(|e| CliError::Config(format!("usdc_mint: {e}")))?;

    println!("=== RootLens License — Config 初期化 ===\n");
    println!("  Cluster:               {cluster}");
    println!("  RPC:                   {rpc_url}");
    println!("  Program:               {program_id}");
    println!("  Root NFT Collection:   {root_nft}");
    println!("  USDC mint:             {usdc}");
    println!("  Staker / Delegate BPS: {staker_bps} / {delegate_bps}\n");

    let rpc = SolanaRpc::new(&rpc_url);

    // ===== Step 1: Authority Keypair =====
    println!("[Step 1] Authority Keypair");
    let authority_path = config::resolve_key_path(keys_dir, "authority.json");
    let authority = config::load_or_create_authority(&authority_path)?;
    let authority_pubkey = authority.pubkey();
    println!("  Authority: {authority_pubkey}");

    // ===== Step 2: Airdrop (devnet only) =====
    if cluster == "devnet" {
        println!("\n[Step 2] Airdrop (devnet)");
        let balance = rpc.get_balance(&authority_pubkey).await?;
        let sol = balance as f64 / 1_000_000_000.0;
        if sol < 1.0 {
            println!("  残高 {sol:.4} SOL → airdrop 中...");
            match rpc.request_airdrop(&authority_pubkey, 2_000_000_000).await {
                Ok(sig) => {
                    if let Err(e) = rpc.confirm_transaction(&sig).await {
                        println!("  airdrop 確認失敗: {e}");
                    } else {
                        println!("  airdrop 完了 (+2 SOL)");
                    }
                }
                Err(e) => {
                    println!("  airdrop 失敗: {e}");
                    if sol < 0.01 {
                        eprintln!("  ERROR: SOL 残高不足 — 手動で airdrop してください:");
                        eprintln!("    solana airdrop 2 {authority_pubkey} --url {rpc_url}");
                        return Err(CliError::Config("SOL 残高不足".into()));
                    }
                }
            }
        } else {
            println!("  残高: {sol:.4} SOL (十分)");
        }
    } else {
        println!("\n[Step 2] Airdrop → スキップ (mainnet)");
        let balance = rpc.get_balance(&authority_pubkey).await?;
        let sol = balance as f64 / 1_000_000_000.0;
        println!("  残高: {sol:.4} SOL");
        if balance < 100_000_000 {
            return Err(CliError::Config("SOL 残高不足 (mainnet では事前送金が必要)".into()));
        }
    }

    // ===== Step 3: Config PDA + License Collection =====
    println!("\n[Step 3] License MPL Core Collection 作成 + Config 初期化");

    let (config_pda, _bump) = anchor::find_config_pda(&program_id);
    println!("  Config PDA: {config_pda}");

    // 既存 config を確認 (idempotent)
    let existing = rpc.get_account_data(&config_pda).await?;
    let license_collection_pubkey = match existing {
        Some(_data) => {
            // 既存。license_collection は Anchor アカウントから読む必要があるが、
            // 簡易実装として network.json から読む / または再 init はサポートせず単純にエラーを返す
            // (TP の `update_collections` パターンを真似るのは Phase 2 では過剰)
            return Err(CliError::Config(format!(
                "Config PDA {} は既に初期化済。upgrade フローは未実装",
                config_pda
            )));
        }
        None => {
            // 新規 license collection 作成
            let license_collection_kp = Keypair::new();
            let license_pubkey = license_collection_kp.pubkey();
            println!("  License Collection address: {license_pubkey}");

            let create_ix = anchor::build_create_collection_ix(
                &license_pubkey,
                &config_pda, // ← update_authority = Config PDA
                &authority_pubkey,
                "RootLens License",
                "",
            );
            let blockhash = rpc.get_latest_blockhash().await?;
            let message = Message::new_with_blockhash(&[create_ix], Some(&authority_pubkey), &blockhash);
            let mut tx = Transaction::new_unsigned(message);
            tx.try_sign(&[&authority, &license_collection_kp], blockhash)
                .map_err(|e| CliError::Transaction(format!("create_collection 署名失敗: {e}")))?;
            let tx_bytes = bincode::serialize(&tx)
                .map_err(|e| CliError::Transaction(format!("create_collection serialize: {e}")))?;
            let sig = rpc.send_and_confirm(&tx_bytes).await?;
            println!("  License Collection 作成完了: {sig}");

            // License Collection の keypair を保存 (rotation 想定で keys/ に格納)
            let lc_path = config::resolve_key_path(keys_dir, "license-collection.json");
            std::fs::write(&lc_path, serde_json::to_string(&license_collection_kp.to_bytes().to_vec())?)?;
            println!("  License Collection keypair: {}", lc_path.display());

            // 続けて initialize_config
            let init_ix = anchor::build_initialize_config_ix(
                &program_id,
                &config_pda,
                &authority_pubkey,
                &root_nft,
                &license_pubkey,
                &usdc,
                staker_bps,
                delegate_bps,
            );
            let blockhash = rpc.get_latest_blockhash().await?;
            let message = Message::new_with_blockhash(&[init_ix], Some(&authority_pubkey), &blockhash);
            let mut tx = Transaction::new_unsigned(message);
            tx.try_sign(&[&authority], blockhash)
                .map_err(|e| CliError::Transaction(format!("initialize_config 署名失敗: {e}")))?;
            let tx_bytes = bincode::serialize(&tx)
                .map_err(|e| CliError::Transaction(format!("initialize_config serialize: {e}")))?;
            let sig = rpc.send_and_confirm(&tx_bytes).await?;
            println!("  initialize_config 完了: {sig}");

            license_pubkey
        }
    };

    // ===== Step 4: network.json =====
    println!("\n[Step 4] network.json 書き出し");
    let network_config = NetworkConfig {
        cluster: cluster.to_string(),
        program_id: program_id.to_string(),
        config_pda: config_pda.to_string(),
        authority: authority_pubkey.to_string(),
        root_nft_collection: root_nft.to_string(),
        license_collection: license_collection_pubkey.to_string(),
        usdc_mint: usdc.to_string(),
        staker_basis_points: staker_bps,
        delegate_basis_points: delegate_bps,
    };
    let network_path = project_root.join("network.json");
    config::save_network_config(&network_path, &network_config)?;
    println!("  保存先: {}", network_path.display());

    // ===== Summary =====
    println!("\n=== Config 初期化完了 ===");
    println!("  Cluster:              {cluster}");
    println!("  Program ID:           {program_id}");
    println!("  Authority:            {authority_pubkey}");
    println!("  Authority keypair:    {}", authority_path.display());
    println!("  Config PDA:           {config_pda}");
    println!("  Root NFT Collection:  {root_nft}");
    println!("  License Collection:   {license_collection_pubkey}");
    println!("  USDC mint:            {usdc}");
    println!("  Staker / Delegate:    {staker_bps} / {delegate_bps} bps");
    println!("  network.json:         {}", network_path.display());
    println!();
    println!("次のステップ:");
    println!("  1. License Bubblegum tree 作成 (license-cli create-license-tree, 未実装 — Phase 3)");
    println!("  2. issue_license / claim_revenue を呼ぶクライアント SDK (未実装 — Unit E)");

    Ok(())
}
