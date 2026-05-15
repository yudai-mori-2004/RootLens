// SPDX-License-Identifier: Apache-2.0

//! RootLens License NFT CLI。
//!
//! TP の `title-cli` と対称に作る。サブコマンド:
//!   - `init-config`: License Collection 作成 + initialize_config + network.json 出力

mod anchor;
mod commands;
mod config;
mod error;
mod rpc;

use std::path::PathBuf;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "license-cli", about = "RootLens License NFT CLI")]
struct Cli {
    /// 鍵ディレクトリ (デフォルト: <project_root>/keys)
    #[arg(long, default_value = "keys", global = true)]
    keys_dir: PathBuf,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// License Collection 作成 + Config PDA 初期化 + network.json 出力
    InitConfig {
        /// Solana cluster (devnet / mainnet)
        #[arg(long, default_value = "devnet")]
        cluster: String,
        /// Solana RPC URL (省略時: cluster 既定)
        #[arg(long)]
        rpc: Option<String>,
        /// license-nft プログラム ID (省略時: DEFAULT_PROGRAM_ID)
        #[arg(long)]
        program_id: Option<String>,
        /// Root NFT Collection pubkey (TP の network.json の ext_collection_mint / RootLens 専用)
        #[arg(long)]
        root_nft_collection: String,
        /// USDC mint pubkey (devnet では mock USDC mint を使う)
        #[arg(long)]
        usdc_mint: String,
        /// ステーカー分配比率 (basis points, 9500 = 95%)
        #[arg(long, default_value_t = 9500)]
        staker_bps: u16,
        /// delegate 分配比率 (basis points, 500 = 5%)
        #[arg(long, default_value_t = 500)]
        delegate_bps: u16,
    },
    /// Config PDA の可変フィールド (BPS / authority) を更新。
    /// root_nft_collection / license_collection / usdc_mint は immutable のため対象外
    UpdateConfig {
        #[arg(long, default_value = "devnet")]
        cluster: String,
        #[arg(long)]
        rpc: Option<String>,
        #[arg(long)]
        program_id: Option<String>,
        /// 新しい admin pubkey (current authority のみ移譲可能)
        #[arg(long)]
        new_authority: Option<String>,
        /// 新しいステーカー BPS (delegate BPS と合計 10000 必須)
        #[arg(long)]
        staker_bps: Option<u16>,
        /// 新しい delegate BPS (staker BPS と合計 10000 必須)
        #[arg(long)]
        delegate_bps: Option<u16>,
    },
    /// 既存 Config PDA を close (audit/dev 用、本番では機能制限要)
    CloseConfig {
        #[arg(long, default_value = "devnet")]
        cluster: String,
        #[arg(long)]
        rpc: Option<String>,
        #[arg(long)]
        program_id: Option<String>,
    },
    /// 任意の MPL Core Collection を新規作成 (主な用途: audit 用 Root Collection)
    CreateCollection {
        #[arg(long, default_value = "devnet")]
        cluster: String,
        #[arg(long)]
        rpc: Option<String>,
        /// keys/ 配下に保存する collection keypair の filename
        #[arg(long, default_value = "test-root-collection.json")]
        keypair_filename: String,
        /// Collection の update_authority pubkey
        #[arg(long)]
        update_authority: String,
        /// Collection の name (metadata 用)
        #[arg(long, default_value = "RootLens Test Root")]
        name: String,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let project_root = std::env::current_dir()?;
    let keys_dir = if cli.keys_dir.is_absolute() {
        cli.keys_dir.clone()
    } else {
        project_root.join(&cli.keys_dir)
    };

    match cli.command {
        Commands::InitConfig {
            cluster,
            rpc,
            program_id,
            root_nft_collection,
            usdc_mint,
            staker_bps,
            delegate_bps,
        } => {
            commands::init_config::run(
                &project_root,
                &keys_dir,
                &cluster,
                rpc.as_deref(),
                program_id.as_deref(),
                &root_nft_collection,
                &usdc_mint,
                staker_bps,
                delegate_bps,
            )
            .await?;
        }
        Commands::UpdateConfig {
            cluster,
            rpc,
            program_id,
            new_authority,
            staker_bps,
            delegate_bps,
        } => {
            commands::update_config::run(
                &keys_dir,
                &cluster,
                rpc.as_deref(),
                program_id.as_deref(),
                new_authority.as_deref(),
                staker_bps,
                delegate_bps,
            )
            .await?;
        }
        Commands::CloseConfig {
            cluster,
            rpc,
            program_id,
        } => {
            commands::close_config::run(
                &keys_dir,
                &cluster,
                rpc.as_deref(),
                program_id.as_deref(),
            )
            .await?;
        }
        Commands::CreateCollection {
            cluster,
            rpc,
            keypair_filename,
            update_authority,
            name,
        } => {
            commands::create_collection::run(
                &keys_dir,
                &cluster,
                rpc.as_deref(),
                &keypair_filename,
                &update_authority,
                &name,
            )
            .await?;
        }
    }
    Ok(())
}
