// SPDX-License-Identifier: Apache-2.0

//! 設定ファイル I/O (network.json, keypair)。

use std::path::Path;

use serde::{Deserialize, Serialize};
#[allow(deprecated)]
use solana_sdk::signer::keypair::Keypair;

use crate::error::CliError;

/// network.json — `init-config` が生成し、後段コマンドが参照する bootstrap ファイル。
///
/// ファイル自体は gitignore。各開発者は自分で `init-config` を実行して
/// 自分の network.json を持つ (= 各々独立した program/Collection を持つ)。
/// 公式が「これが公式の network.json」と表明したものが公式扱いになる。
#[derive(Debug, Serialize, Deserialize)]
pub struct NetworkConfig {
    pub cluster: String,
    pub program_id: String,
    pub config_pda: String,
    pub authority: String,
    pub title_core_collection: String,
    pub license_collection: String,
    pub usdc_mint: String,
    pub staker_basis_points: u16,
    pub delegate_basis_points: u16,
}

#[allow(deprecated)]
pub fn load_or_create_authority(path: &Path) -> Result<Keypair, CliError> {
    if path.exists() {
        println!("  既存の authority keypair をロード: {}", path.display());
        let raw = std::fs::read_to_string(path)?;
        let bytes: Vec<u8> = serde_json::from_str(&raw)?;
        Keypair::from_bytes(&bytes)
            .map_err(|e| CliError::Config(format!("キーペアのパースに失敗: {e}")))
    } else {
        println!("  新しい authority keypair を生成中...");
        let kp = Keypair::new();
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let bytes: Vec<u8> = kp.to_bytes().to_vec();
        std::fs::write(path, serde_json::to_string(&bytes)?)?;
        println!("  保存先: {}", path.display());
        Ok(kp)
    }
}

pub fn save_network_config(path: &Path, config: &NetworkConfig) -> Result<(), CliError> {
    let json = serde_json::to_string_pretty(config)? + "\n";
    std::fs::write(path, json)?;
    Ok(())
}

pub fn resolve_key_path(keys_dir: &Path, filename: &str) -> std::path::PathBuf {
    keys_dir.join(filename)
}

pub fn resolve_rpc_url(cluster: &str, rpc_override: Option<&str>) -> String {
    if let Some(rpc) = rpc_override {
        return rpc.to_string();
    }
    if let Ok(env_url) = std::env::var("SOLANA_RPC_URL") {
        if !env_url.is_empty() {
            return env_url;
        }
    }
    match cluster {
        "mainnet" => "https://api.mainnet-beta.solana.com".to_string(),
        _ => "https://api.devnet.solana.com".to_string(),
    }
}

/// TP の network.json から `core_collection_mint` を読み取って TitleCore として返す。
pub fn read_tp_core_collection(path: &Path) -> Result<String, CliError> {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| CliError::Config(format!("TP network.json を読めない ({}): {e}", path.display())))?;
    let v: serde_json::Value = serde_json::from_str(&raw)?;
    v.get("core_collection_mint")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| CliError::Config("TP network.json に core_collection_mint が無い".into()))
}
