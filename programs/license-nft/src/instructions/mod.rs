// SPDX-License-Identifier: Apache-2.0

pub mod claim_revenue;
pub mod close_config;
pub mod create_license_tree;
pub mod initialize_config;
pub mod issue_license;
pub mod update_config;

// Anchor の #[program] マクロは handler 名をモジュールから glob 解決するため
// pub use *::* が必要。`handler` 関数名は重複するが Anchor が呼ぶのは canonical path
// (instructions::xxx::handler) なので動作影響なし。glob warning は許容。
pub use claim_revenue::*;
pub use close_config::*;
pub use create_license_tree::*;
pub use initialize_config::*;
pub use issue_license::*;
pub use update_config::*;
