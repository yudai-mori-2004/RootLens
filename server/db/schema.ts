import {
  pgTable, text, integer, timestamp, jsonb, index, numeric,
} from "drizzle-orm/pg-core";

// SPECS_JA §2.7 のクリップ状態機械 + §6.2 のサーバパイプラインを永続化するスキーマ。
//
// 1 クリップ = 1 行。 同じ wallet が同じ MCAP を 2 度 upload した場合は
// content_hash でユニーク制約をかけて、 重複アップロードはサーバ側で no-op (= §4.3 重複排除)。
//
// 状態は文字列 enum (= Drizzle/Postgres の pgEnum でなく text + check で扱う、 後で追加し易い)。

export const clips = pgTable(
  "clips",
  {
    /// 内部 ID (= 端末から指定された UUID、 または server 生成)。 Root NFT 発行後は asset_id が
    /// 入るが、 主キーとしてはこの id が使われ続ける (= 永続的識別子)。
    id: text("id").primaryKey(),

    /// 撮影者の Solana wallet pubkey (base58)。
    walletPubkey: text("wallet_pubkey").notNull(),

    /// taskCatalog.ts の id 参照。
    taskId: text("task_id").notNull(),

    /// SPECS_JA §2.7 の状態。
    /// 'uploading' | 'processing' | 'ready' | 'staked' | 'error'
    state: text("state").notNull().default("uploading"),

    /// 撮影者「送る」 押下時刻 (= state machine 開始時刻)。
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),

    /// 端末側 VLM 達成確度 (= 0..100)。 撮影者の「送る」 押下時に渡される。
    achievementConfidence: integer("achievement_confidence"),

    /// 端末から upload された 生 MP4 の sha256 (hex)。 重複検知 + 冪等な workflow キー。
    contentHash: text("content_hash"),

    /// R2 オブジェクトキー / プレフィックス。
    rawMp4Key: text("raw_mp4_key"),               // バケット = R2_BUCKET_RAW、 端末 upload された MP4
    blurredMp4Key: text("blurred_mp4_key"),       // バケット = R2_BUCKET_BLURRED、 Pipeline 2 出力 (= preview 兼 dataset RGB ソース)
    datasetPrefix: text("dataset_prefix"),        // Pipeline 3 出力 (= LeRobot v3 dataset の R2 prefix、 buyer 配信用)。 Pipeline 3 未実行なら NULL

    /// processing 中の現在ステップ (= Pipeline 2 の進行表示)。
    /// 'c2pa-verify' | 'anonymize' | 'quality-eval' | 'tp-submit'
    processingStep: text("processing_step"),

    /// 品質評価結果 (= SPECS_JA §6.3)。
    qualityScore: integer("quality_score"),
    qualityBreakdown: jsonb("quality_breakdown").$type<{
      anyHandRatio: number;
      twoHandRatio: number;
      depthValidRatio: number | null;
      syncRatio: number;
      frameGapCount: number;
    }>(),

    /// TP 発行された Root NFT の asset id (= Bubblegum cNFT id、 base58)。
    rootAssetId: text("root_asset_id"),

    /// Bubblegum delegate (= owner と等しければ unstaked、 異なれば staked)。
    delegate: text("delegate"),

    /// ライセンス販売の集計 (= staked 後に更新、 別 worker で集計してもよい)。
    licenseCount: integer("license_count").notNull().default(0),
    revenueUsdc: numeric("revenue_usdc", { precision: 18, scale: 6 }).notNull().default("0"),

    /// 処理エラー時の最終 message (= 撮影者にサポート連絡を促すための文言)。
    errorMessage: text("error_message"),

    /// WDK workflow の run id (= status query / 手動 cancel 用に保持)。
    workflowRunId: text("workflow_run_id"),
  },
  (t) => [
    index("clips_wallet_idx").on(t.walletPubkey),
    index("clips_state_idx").on(t.state),
    index("clips_content_hash_idx").on(t.contentHash),
  ],
);

export type Clip = typeof clips.$inferSelect;
export type NewClip = typeof clips.$inferInsert;

/// ToS 同意ログ (= SPECS_JA §4.4.3)。
/// 1 wallet × 1 tos_version で 1 行。
export const tosConsents = pgTable(
  "tos_consents",
  {
    id: text("id").primaryKey(),
    walletPubkey: text("wallet_pubkey").notNull(),
    tosVersion: text("tos_version").notNull(),
    tosHash: text("tos_hash").notNull(),
    consentedAt: timestamp("consented_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (t) => [
    index("tos_consents_wallet_version_idx").on(t.walletPubkey, t.tosVersion),
  ],
);

export type TosConsent = typeof tosConsents.$inferSelect;
export type NewTosConsent = typeof tosConsents.$inferInsert;
