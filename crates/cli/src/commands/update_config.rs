// SPDX-License-Identifier: Apache-2.0

//! `license-cli update-config`: Config PDA の可変フィールド (BPS / authority) を更新。
//! root_nft_collection / license_collection / usdc_mint は immutable のため対象外。

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
    new_authority: Option<&str>,
    new_staker_bps: Option<u16>,
    new_delegate_bps: Option<u16>,
) -> Result<(), CliError> {
    if new_authority.is_none() && new_staker_bps.is_none() && new_delegate_bps.is_none() {
        return Err(CliError::Config(
            "何か 1 つ以上の更新フィールドを指定すること (--new-authority / --staker-bps / --delegate-bps)".into(),
        ));
    }
    match (new_staker_bps, new_delegate_bps) {
        (Some(s), Some(d)) if (s as u32) + (d as u32) != 10_000 => {
            return Err(CliError::Config(format!(
                "staker_bps + delegate_bps が 10000 ではない: {} + {} = {}",
                s, d, s as u32 + d as u32
            )));
        }
        (Some(_), None) | (None, Some(_)) => {
            return Err(CliError::Config(
                "BPS は --staker-bps と --delegate-bps を両方指定すること (合計 10000)".into(),
            ));
        }
        _ => {}
    }

    let rpc_url = config::resolve_rpc_url(cluster, rpc_override);
    let program_id: Pubkey = program_id_override
        .unwrap_or(super::init_config::DEFAULT_PROGRAM_ID)
        .parse()
        .map_err(|e| CliError::Config(format!("program_id: {e}")))?;

    let new_authority_pk: Option<Pubkey> = match new_authority {
        Some(s) => Some(
            s.parse()
                .map_err(|e| CliError::Config(format!("new_authority: {e}")))?,
        ),
        None => None,
    };

    println!("=== update_config ===");
    println!("  Program:  {program_id}");
    if let Some(a) = new_authority_pk {
        println!("  → new_authority:    {a}");
    }
    if let (Some(s), Some(d)) = (new_staker_bps, new_delegate_bps) {
        println!("  → new_staker_bps:   {s} ({:.1}%)", s as f32 / 100.0);
        println!("  → new_delegate_bps: {d} ({:.1}%)", d as f32 / 100.0);
    }

    let rpc = SolanaRpc::new(&rpc_url);
    let auth_path = config::resolve_key_path(keys_dir, "authority.json");
    let authority = config::load_or_create_authority(&auth_path)?;
    let (config_pda, _) = anchor::find_config_pda(&program_id);
    println!("  Config PDA: {config_pda}");

    let ix = anchor::build_update_config_ix(
        &program_id,
        &config_pda,
        &authority.pubkey(),
        new_authority_pk.as_ref(),
        new_staker_bps,
        new_delegate_bps,
    );
    let blockhash = rpc.get_latest_blockhash().await?;
    let message = Message::new_with_blockhash(&[ix], Some(&authority.pubkey()), &blockhash);
    let mut tx = Transaction::new_unsigned(message);
    tx.try_sign(&[&authority], blockhash)
        .map_err(|e| CliError::Transaction(format!("update_config 署名失敗: {e}")))?;
    let tx_bytes = bincode::serialize(&tx)
        .map_err(|e| CliError::Transaction(format!("serialize: {e}")))?;
    let sig = rpc.send_and_confirm(&tx_bytes).await?;
    println!("  update_config 完了: {sig}");
    Ok(())
}
