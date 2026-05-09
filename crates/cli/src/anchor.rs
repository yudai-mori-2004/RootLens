// SPDX-License-Identifier: Apache-2.0

//! Anchor 命令 ix builder + MPL Core 直接 ix builder。
//!
//! TP の crates/cli/src/anchor.rs と同じパターン。Anchor の IDL ジェネレータには
//! 依存せず、命令 discriminator と borsh シリアライズを手動で組み立てる。

use sha2::{Digest, Sha256};
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    system_program,
};

/// MPL Core プログラム ID。
pub const MPL_CORE_PROGRAM_ID: &str = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
/// Bubblegum プログラム ID (CollectionV2 の BubblegumV2 plugin authority)。
pub const BUBBLEGUM_PROGRAM_ID: &str = "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY";

/// Anchor 命令 discriminator: sha256("global:<name>")[0..8]
pub fn anchor_discriminator(name: &str) -> [u8; 8] {
    let mut hasher = Sha256::new();
    hasher.update(format!("global:{name}").as_bytes());
    let result = hasher.finalize();
    let mut out = [0u8; 8];
    out.copy_from_slice(&result[..8]);
    out
}

/// Config PDA: seeds=[b"config"]
pub fn find_config_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"config"], program_id)
}

/// close_config ix を構築する。authority signs, rent goes back to authority.
pub fn build_close_config_ix(
    program_id: &Pubkey,
    config_pda: &Pubkey,
    authority: &Pubkey,
) -> Instruction {
    Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new(*authority, true),
            AccountMeta::new(*config_pda, false),
        ],
        data: anchor_discriminator("close_config").to_vec(),
    }
}

/// update_config ix を構築する。
///
/// args 順序は src/instructions/update_config.rs の handler に一致：
///   new_authority: Option<Pubkey>
///   new_staker_basis_points: Option<u16>
///   new_delegate_basis_points: Option<u16>
///
/// Borsh の Option encoding: None = 0x00, Some = 0x01 + 値
pub fn build_update_config_ix(
    program_id: &Pubkey,
    config_pda: &Pubkey,
    authority: &Pubkey,
    new_authority: Option<&Pubkey>,
    new_staker_bps: Option<u16>,
    new_delegate_bps: Option<u16>,
) -> Instruction {
    let mut data = Vec::with_capacity(8 + 33 + 3 + 3);
    data.extend_from_slice(&anchor_discriminator("update_config"));
    match new_authority {
        Some(a) => {
            data.push(1);
            data.extend_from_slice(&a.to_bytes());
        }
        None => data.push(0),
    }
    match new_staker_bps {
        Some(v) => {
            data.push(1);
            data.extend_from_slice(&v.to_le_bytes());
        }
        None => data.push(0),
    }
    match new_delegate_bps {
        Some(v) => {
            data.push(1);
            data.extend_from_slice(&v.to_le_bytes());
        }
        None => data.push(0),
    }

    Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new_readonly(*authority, true), // authority (signer, has_one)
            AccountMeta::new(*config_pda, false), // config PDA (writable)
        ],
        data,
    }
}

/// initialize_config ix を構築する。
///
/// args 順序は src/instructions/initialize_config.rs の handler シグネチャに一致：
///   title_core_collection, license_collection, usdc_mint, staker_bps, delegate_bps
pub fn build_initialize_config_ix(
    program_id: &Pubkey,
    config_pda: &Pubkey,
    authority: &Pubkey,
    title_core_collection: &Pubkey,
    license_collection: &Pubkey,
    usdc_mint: &Pubkey,
    staker_basis_points: u16,
    delegate_basis_points: u16,
) -> Instruction {
    let mut data = Vec::with_capacity(8 + 32 + 32 + 32 + 2 + 2);
    data.extend_from_slice(&anchor_discriminator("initialize_config"));
    data.extend_from_slice(&title_core_collection.to_bytes());
    data.extend_from_slice(&license_collection.to_bytes());
    data.extend_from_slice(&usdc_mint.to_bytes());
    data.extend_from_slice(&staker_basis_points.to_le_bytes());
    data.extend_from_slice(&delegate_basis_points.to_le_bytes());

    Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new(*authority, true), // authority (signer, writable - payer)
            AccountMeta::new(*config_pda, false), // config PDA (writable, init)
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

/// MPL Core CreateCollectionV2 を直接構築する。
///
/// MPL Core プログラムは Anchor ではなく Borsh enum でディスパッチする。
/// CreateCollectionV2: enum variant index = 21
///
/// data layout:
///   [21]                                   ← variant index
///   borsh String name
///   borsh String uri
///   Option<Vec<PluginAuthorityPair>>      ← plugins: Some(vec![BubblegumV2])
///   Option<Vec<ExternalPluginAdapter>>    ← external_plugins: None
///
/// accounts:
///   0. collection (writable, signer)         ← 新規 collection の addr
///   1. update_authority (readonly, optional) ← 我々はここに Config PDA を渡す
///   2. payer (writable, signer)              ← rent 払い + authority 移譲権限
///   3. system_program
///
/// Bubblegum V2 はコレクションに BubblegumV2 plugin (permanent) を要求する。
/// このプラグインは作成時のみ追加可能。後から AddCollectionPlugin では不可。
pub fn build_create_collection_ix(
    collection: &Pubkey,
    update_authority: &Pubkey,
    payer: &Pubkey,
    name: &str,
    uri: &str,
) -> Instruction {
    let mpl_core: Pubkey = MPL_CORE_PROGRAM_ID.parse().unwrap();
    let bubblegum: Pubkey = BUBBLEGUM_PROGRAM_ID.parse().unwrap();

    let mut data = Vec::new();
    data.push(21); // CreateCollectionV2
    data.extend_from_slice(&borsh_string(name));
    data.extend_from_slice(&borsh_string(uri));
    // plugins: Option<Vec<PluginAuthorityPair>> = Some(vec![BubblegumV2 with authority=Bubblegum])
    data.push(1); // Option::Some
    data.extend_from_slice(&1u32.to_le_bytes()); // Vec len = 1
    data.push(15); // Plugin::BubblegumV2 variant index
    data.push(1); // Option::Some for authority
    data.push(3); // Authority::Address variant
    data.extend_from_slice(&bubblegum.to_bytes());
    // external_plugins: Option<Vec<_>> = None
    data.push(0);

    Instruction {
        program_id: mpl_core,
        accounts: vec![
            AccountMeta::new(*collection, true),
            AccountMeta::new_readonly(*update_authority, false),
            AccountMeta::new(*payer, true),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

fn borsh_string(s: &str) -> Vec<u8> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(4 + bytes.len());
    out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(bytes);
    out
}
