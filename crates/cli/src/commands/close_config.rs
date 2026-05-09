// SPDX-License-Identifier: Apache-2.0

//! `license-cli close-config`: 現在の Config PDA を close、rent を authority に戻す。

use std::path::Path;

#[allow(deprecated)]
use solana_sdk::{
    message::Message, pubkey::Pubkey, signer::Signer, transaction::Transaction,
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
    program_id_override: Option<&str>,
) -> Result<(), CliError> {
    let rpc_url = config::resolve_rpc_url(cluster, rpc_override);
    let program_id: Pubkey = program_id_override
        .unwrap_or(super::init_config::DEFAULT_PROGRAM_ID)
        .parse()
        .map_err(|e| CliError::Config(format!("program_id: {e}")))?;

    println!("=== close_config ===");
    println!("  Program: {program_id}");

    let rpc = SolanaRpc::new(&rpc_url);
    let auth_path = config::resolve_key_path(keys_dir, "authority.json");
    let authority = config::load_or_create_authority(&auth_path)?;
    let (config_pda, _) = anchor::find_config_pda(&program_id);
    println!("  Config PDA: {config_pda}");

    let existing = rpc.get_account_data(&config_pda).await?;
    if existing.is_none() {
        println!("  Config PDA は既に存在しない (close 済 or 未 init)。何もしない。");
        return Ok(());
    }

    let ix = anchor::build_close_config_ix(&program_id, &config_pda, &authority.pubkey());
    let blockhash = rpc.get_latest_blockhash().await?;
    let message = Message::new_with_blockhash(&[ix], Some(&authority.pubkey()), &blockhash);
    let mut tx = Transaction::new_unsigned(message);
    tx.try_sign(&[&authority], blockhash)
        .map_err(|e| CliError::Transaction(format!("close_config 署名失敗: {e}")))?;
    let tx_bytes = bincode::serialize(&tx)
        .map_err(|e| CliError::Transaction(format!("serialize: {e}")))?;
    let sig = rpc.send_and_confirm(&tx_bytes).await?;
    println!("  close_config 完了: {sig}");
    Ok(())
}
