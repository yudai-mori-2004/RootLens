import {
  pgTable, text, integer, timestamp, jsonb, index, numeric,
} from "drizzle-orm/pg-core";
import type { QualityBreakdown } from "../shared/api-types";

// DATA_SPECS §6 のクリップ状態機械 + §3 のサーバパイプラインを永続化するスキーマ。
//
// 1 クリップ = 1 行。 同じ wallet が同じ content_id (= D2 active manifest signature SHA-256) を
// 2 度 upload した場合は idempotent に既存行を返す (= 重複排除)。

export const clips = pgTable(
  "clips",
  {
    /// 内部 ID (= 端末から指定された UUID、 または server 生成)。
    /// Root NFT 発行後も主キーは変わらない (= 永続的識別子)。
    id: text("id").primaryKey(),

    /// 撮影者の Solana wallet pubkey (base58)。
    walletPubkey: text("wallet_pubkey").notNull(),

    /// タスクカタログ ID 参照。
    taskId: text("task_id").notNull(),

    /// DATA_SPECS §6 の状態。
    /// 'uploading' | 'processing' | 'ready' | 'staked' | 'error'
    state: text("state").notNull().default("uploading"),

    /// 行作成時刻 (= 撮影者「送る」 押下時刻)。
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),

    /// 端末側 VLM 達成確度 (= 0..100)。 撮影者「送る」 押下時に渡される。
    achievementConfidence: integer("achievement_confidence"),

    /// C2PA D2 アクティブマニフェスト署名の SHA-256 hex (= DATA_SPECS §1.1)。
    /// 端末で確定し、 以降全パイプラインを通じて不変の識別子。
    contentId: text("content_id"),

    /// R2 オブジェクトキー / プレフィックス。
    /// signedMp4Key = raw/<content_id>/rgb.mp4 (= 端末が C2PA D2 署名 + 顔ぼかしを終えてアップロードした MP4)
    /// datasetPrefix = datasets/<root_asset_id>/ (= Pipeline 3 出力。 未実行なら NULL)
    signedMp4Key: text("signed_mp4_key"),
    datasetPrefix: text("dataset_prefix"),

    /// processing 中の現在ステップ (= Pipeline 2 の進行表示用)。
    /// 'metadata-scan' | 'frame-sampling' | 'vlm-score' | 'gtsam-eval' | 'tp-submit'
    processingStep: text("processing_step"),

    /// 品質評価結果 (= DATA_SPECS §3)。 4 層 + GTSAM の構造化 JSON。
    /// 各層の score + 全 sub-metric 値を保持。 撮影者へのフィードバックと
    /// 買い手向けカタログフィルタの両方に使う。
    qualityScore: integer("quality_score"),
    qualityBreakdown: jsonb("quality_breakdown").$type<QualityBreakdown>(),

    /// idle_ratio (= task_activity == 0 のフレーム割合) は score に算入しないが、
    /// カタログフィルタ用に別カラムで公開する。
    idleRatio: numeric("idle_ratio", { precision: 5, scale: 4 }),

    /// TP 発行された Root NFT の asset id (= Bubblegum cNFT id、 base58)。
    rootAssetId: text("root_asset_id"),

    /// TP が返した signed_json_uri (= TEE 署名済メタデータ JSON への URI)。
    signedJsonUri: text("signed_json_uri"),

    /// Bubblegum delegate (= owner と等しければ unstaked、 異なれば staked)。
    delegate: text("delegate"),

    /// ライセンス販売の集計 (= staked 後に更新)。 別 worker で再集計してもよい。
    licenseCount: integer("license_count").notNull().default(0),
    revenueUsdc: numeric("revenue_usdc", { precision: 18, scale: 6 }).notNull().default("0"),

    /// 処理エラー時の最終メッセージ (= 撮影者にサポート連絡を促す文言)。
    errorMessage: text("error_message"),

    /// WDK workflow の run id (= status query / 手動 cancel 用に保持)。
    workflowRunId: text("workflow_run_id"),
  },
  (t) => [
    index("clips_wallet_idx").on(t.walletPubkey),
    index("clips_state_idx").on(t.state),
    index("clips_content_id_idx").on(t.contentId),
  ],
);

export type Clip = typeof clips.$inferSelect;
export type NewClip = typeof clips.$inferInsert;

/// ToS 同意ログ (= DATA_SPECS §5.2)。
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
