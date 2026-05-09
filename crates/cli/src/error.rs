// SPDX-License-Identifier: Apache-2.0

#[derive(Debug, thiserror::Error)]
pub enum CliError {
    #[error("設定エラー: {0}")]
    Config(String),
    #[error("RPC通信エラー: {0}")]
    Rpc(String),
    #[error("トランザクション失敗: {0}")]
    Transaction(String),
    #[error("ファイルI/Oエラー: {0}")]
    Io(#[from] std::io::Error),
    #[error("HTTPエラー: {0}")]
    Http(#[from] reqwest::Error),
    #[error("JSONエラー: {0}")]
    Json(#[from] serde_json::Error),
}
