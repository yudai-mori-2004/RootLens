// SPDX-License-Identifier: Apache-2.0
//
// title-protocol/crates/cli/src/{solana.rs, client.rs} (Apache-2.0) を mock-device 用に
// 縮約して取り込む。 仕様参照: document/v0.1.3/tasks/02-pipeline-1-mock-cli/README.md step 6
// (= cNFT 発行)。
//
// 流れ:
//   1. TP Gateway `POST /extension/solana` で partial_tx (= base64 VersionedTransaction) 取得
//   2. payer keypair (= Solana JSON 配列、 64 byte = 32 seed + 32 pubkey) を読んで署名 slot を埋める
//   3. Solana RPC `sendTransaction` で broadcast、 confirmed まで待機
//   4. broadcast 後の TreeConfig PDA を読んで `num_minted - 1` を nonce として取得
//   5. asset_id = find_program_address([b"asset", tree, &nonce.to_le_bytes()], BUBBLEGUM_ID)
//      (= mpl_bubblegum::utils::get_asset_id と同じ derivation)

use anyhow::{anyhow, Context, Result};
use base64::Engine as _;
use ed25519_dalek::{Signer, SigningKey};
use serde::Serialize;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::commitment_config::CommitmentConfig;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Signature;
use solana_sdk::transaction::VersionedTransaction;
use std::str::FromStr;

/// Bubblegum V2 program id (= mpl_bubblegum::MPL_BUBBLEGUM_ID)。
const BUBBLEGUM_PROGRAM_ID: &str = "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY";

/// TreeConfig アカウント (= mpl_bubblegum::TreeConfig) の `num_minted` フィールド開始 offset。
/// レイアウト: discriminator(8) + tree_creator(32) + tree_delegate(32) + total_mint_capacity(8) +
/// num_minted(8) + ...
const TREE_CONFIG_NUM_MINTED_OFFSET: usize = 8 + 32 + 32 + 8;

#[derive(Serialize)]
struct ExtensionRequest<'a> {
    offchain_data_url: &'a str,
    payer: &'a str,
    merkle_tree: &'a str,
    recent_blockhash: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    collection: Option<&'a str>,
}

/// cNFT 発行結果。
pub struct MintOutcome {
    /// Solana cNFT asset id (= base58、 /api/clips の rootAssetId に渡す)。
    pub root_asset_id: String,
    /// broadcast tx signature (= base58)。
    pub tx_signature: String,
}

/// Solana CLI 形式 (= 64 要素 u8 JSON 配列、 32 seed + 32 pubkey) の keypair を読む。
pub fn load_keypair(path: &std::path::Path) -> Result<SigningKey> {
    let data = std::fs::read_to_string(path)
        .with_context(|| format!("read keypair {}", path.display()))?;
    let bytes: Vec<u8> =
        serde_json::from_str(&data).context("parse keypair JSON (= u8 array of length 64)")?;
    if bytes.len() != 64 {
        return Err(anyhow!("keypair must be 64 bytes, got {}", bytes.len()));
    }
    let seed: [u8; 32] = bytes[..32].try_into().unwrap();
    Ok(SigningKey::from_bytes(&seed))
}

pub fn pubkey(key: &SigningKey) -> Pubkey {
    Pubkey::new_from_array(key.verifying_key().to_bytes())
}

/// partial_tx (= base64 + bincode) を VersionedTransaction に decode。
fn decode_partial_tx(b64: &str) -> Result<VersionedTransaction> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .context("base64 decode partial_tx")?;
    bincode::deserialize(&bytes).context("bincode deserialize VersionedTransaction")
}

/// payer 鍵で署名 slot を埋める。
fn sign_transaction(tx: &mut VersionedTransaction, key: &SigningKey) -> Result<()> {
    let pk = pubkey(key);
    let message_bytes = tx.message.serialize();
    let sig = key.sign(&message_bytes);

    let num_signers = tx.message.header().num_required_signatures as usize;
    let static_keys = tx.message.static_account_keys();
    let index = static_keys
        .iter()
        .take(num_signers)
        .position(|k| k == &pk)
        .ok_or_else(|| anyhow!("payer {} not in tx signers", pk))?;
    if tx.signatures.len() <= index {
        return Err(anyhow!("signature slot {} missing", index));
    }
    tx.signatures[index] = Signature::from(sig.to_bytes());
    Ok(())
}

/// TreeConfig PDA = find_program_address([merkle_tree.as_ref()], BUBBLEGUM_ID)
fn derive_tree_config(merkle_tree: &Pubkey, bubblegum_id: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[merkle_tree.as_ref()], bubblegum_id).0
}

/// asset_id = find_program_address([b"asset", tree, &nonce.to_le_bytes()], BUBBLEGUM_ID)
fn derive_asset_id(merkle_tree: &Pubkey, nonce: u64, bubblegum_id: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"asset", merkle_tree.as_ref(), &nonce.to_le_bytes()],
        bubblegum_id,
    )
    .0
}

/// step 6 entry point。 全失敗時 Error、 成功時 (root_asset_id, tx_signature) を返す。
pub async fn mint_cnft(
    tp_gateway: &str,
    offchain_data_url: &str,
    payer: &SigningKey,
    merkle_tree: &str,
    collection: Option<&str>,
    rpc_url: &str,
) -> Result<MintOutcome> {
    let bubblegum_id = Pubkey::from_str(BUBBLEGUM_PROGRAM_ID).unwrap();
    let merkle_pk =
        Pubkey::from_str(merkle_tree).with_context(|| format!("parse merkle_tree {merkle_tree}"))?;
    let payer_pk = pubkey(payer);

    let rpc = RpcClient::new_with_commitment(rpc_url.to_string(), CommitmentConfig::confirmed());

    let blockhash = rpc
        .get_latest_blockhash()
        .await
        .context("get latest blockhash")?;

    // step 6a: POST /extension/solana
    let url = format!("{}/extension/solana", tp_gateway.trim_end_matches('/'));
    let req_body = ExtensionRequest {
        offchain_data_url,
        payer: &payer_pk.to_string(),
        merkle_tree,
        recent_blockhash: &blockhash.to_string(),
        collection,
    };
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .context("build reqwest client")?;
    let resp = http
        .post(&url)
        .json(&req_body)
        .send()
        .await
        .with_context(|| format!("POST {url}"))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(anyhow!("TP /extension/solana {status}: {body}"));
    }
    let json: serde_json::Value = resp.json().await.context("parse /extension/solana JSON")?;
    let partial_tx_b64 = json
        .get("partial_tx")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("missing partial_tx in response"))?;

    // step 6b: decode + sign + broadcast
    let mut tx = decode_partial_tx(partial_tx_b64)?;
    sign_transaction(&mut tx, payer)?;
    let sig = rpc
        .send_and_confirm_transaction(&tx)
        .await
        .context("send_and_confirm_transaction")?;

    // step 6c: nonce = TreeConfig::num_minted - 1 → asset_id 導出
    let tree_config_pda = derive_tree_config(&merkle_pk, &bubblegum_id);
    let account_data = rpc
        .get_account_data(&tree_config_pda)
        .await
        .with_context(|| format!("get TreeConfig {tree_config_pda}"))?;
    if account_data.len() < TREE_CONFIG_NUM_MINTED_OFFSET + 8 {
        return Err(anyhow!(
            "TreeConfig too short: {} bytes (need >= {})",
            account_data.len(),
            TREE_CONFIG_NUM_MINTED_OFFSET + 8
        ));
    }
    let mut buf = [0u8; 8];
    buf.copy_from_slice(
        &account_data[TREE_CONFIG_NUM_MINTED_OFFSET..TREE_CONFIG_NUM_MINTED_OFFSET + 8],
    );
    let num_minted = u64::from_le_bytes(buf);
    if num_minted == 0 {
        return Err(anyhow!(
            "TreeConfig.num_minted == 0 after mint (= unexpected)"
        ));
    }
    let nonce = num_minted - 1;
    let asset_id = derive_asset_id(&merkle_pk, nonce, &bubblegum_id);

    Ok(MintOutcome {
        root_asset_id: asset_id.to_string(),
        tx_signature: sig.to_string(),
    })
}
