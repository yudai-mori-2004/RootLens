// SPDX-License-Identifier: Apache-2.0
//
//! `license-cli create-collection`: 任意の MPL Core Collection を新規作成。
//!
//! 主な用途は audit/test 環境での Root Collection (TP TitleCore のテスト代替) 作成。
//! BubblegumV2 plugin を作成時に永続付与するため、Bubblegum cNFT の mint 先に使える。

use std::path::Path;

#[allow(deprecated)]
use solana_sdk::{
    message::Message,
    pubkey::Pubkey,
    signer::{keypair::Keypair, Signer},
    transaction::Transaction,
};

use crate::anchor;
use crate::config;
use crate::error::CliError;
use crate::rpc::SolanaRpc;

#[allow(deprecated)]
pub async fn run(
    keys_dir: &Path,
    cluster: &str,
    rpc_override: Option<&str>,
    keypair_filename: &str,
    update_authority: &str,
    name: &str,
) -> Result<(), CliError> {
    let rpc_url = config::resolve_rpc_url(cluster, rpc_override);
    let rpc = SolanaRpc::new(&rpc_url);

    let payer = config::load_or_create_authority(&config::resolve_key_path(
        keys_dir,
        "deployer.json",
    ))?;

    // collection keypair を作成 (or ロード)
    let kp_path = config::resolve_key_path(keys_dir, keypair_filename);
    let collection_kp: Keypair = if kp_path.exists() {
        let raw = std::fs::read_to_string(&kp_path)?;
        let bytes: Vec<u8> = serde_json::from_str(&raw)?;
        Keypair::from_bytes(&bytes)
            .map_err(|e| CliError::Config(format!("collection keypair: {e}")))?
    } else {
        let kp = Keypair::new();
        if let Some(dir) = kp_path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(&kp_path, serde_json::to_string(&kp.to_bytes().to_vec())?)?;
        kp
    };

    let update_auth: Pubkey = update_authority
        .parse()
        .map_err(|e| CliError::Config(format!("update_authority: {e}")))?;

    println!("=== create-collection ===");
    println!("  Collection address:    {}", collection_kp.pubkey());
    println!("  Collection keypair:    {}", kp_path.display());
    println!("  Update authority:      {update_auth}");
    println!("  Payer:                 {}", payer.pubkey());
    println!("  Name:                  {name}");

    // 既に on-chain なら skip
    if rpc.get_account_data(&collection_kp.pubkey()).await?.is_some() {
        println!("  既に on-chain、skip");
        return Ok(());
    }

    let ix = anchor::build_create_collection_ix(
        &collection_kp.pubkey(),
        &update_auth,
        &payer.pubkey(),
        name,
        "",
    );
    let blockhash = rpc.get_latest_blockhash().await?;
    let message = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);
    let mut tx = Transaction::new_unsigned(message);
    tx.try_sign(&[&payer, &collection_kp], blockhash)
        .map_err(|e| CliError::Transaction(format!("signature: {e}")))?;
    let tx_bytes = bincode::serialize(&tx)
        .map_err(|e| CliError::Transaction(format!("serialize: {e}")))?;
    let sig = rpc.send_and_confirm(&tx_bytes).await?;
    println!("  作成完了: {sig}");
    Ok(())
}
