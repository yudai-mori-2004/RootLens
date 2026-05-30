import {
  pgTable, text, integer, bigint, timestamp, jsonb, index, uniqueIndex, numeric,
} from "drizzle-orm/pg-core";
import type { QualityVector } from "../shared/api-types";

// DATA_SPECS §6 のクリップ状態機械 + §3 のサーバパイプラインを永続化するスキーマ。
//
// 1 クリップ = 1 行。 列は論理グループ (識別 / ライフサイクル / 撮影ファクト / 来歴 / Pipeline 2 / 収益)
// で並べる。 R2 に置く大容量データ (rgb.mp4 / realtime_handpose.jsonl / semantic.jsonl / wilor.jsonl 等) は
// DB に持たず、 signature_hash をキーに参照する (= DATA_SPECS §5)。 ストレージキーは signature_hash から
// 100% 導出可能 (raw/<sig>/rgb.mp4 等) なので列に持たない (= コード側ヘルパーで導出)。
//
// 重複排除キー (wallet_pubkey, signature_hash, network) は UNIQUE 制約で DB が保証する。 network を
// 含めるのは devnet で発行済みの動画を後で mainnet で発行し直せるようにするため (= network 違いは別 clip)。

export const clips = pgTable(
  "clips",
  {
    // ── 識別・所有 ───────────────────────────────────────────────────
    /// 内部 ID (= 端末指定 UUID、 または server 生成)。 Root NFT 発行後も不変。
    id: text("id").primaryKey(),

    /// 撮影者の Solana wallet pubkey (base58)。
    walletPubkey: text("wallet_pubkey").notNull(),

    /// C2PA D2 アクティブマニフェスト署名の SHA-256 hex (= DATA_SPECS §1.1)。
    /// 端末で確定し、 全パイプラインを通じて不変の実体キー。 raw/ と processed/ の dir キー。
    signatureHash: text("signature_hash").notNull(),

    /// cNFT を発行した Solana ネットワーク (= "devnet" | "mainnet")。 重複排除キーの一部。
    network: text("network").notNull().default("devnet"),

    // ── ライフサイクル ───────────────────────────────────────────────
    /// DATA_SPECS §6 の状態。 'uploading' | 'processing' | 'ready' | 'staked' | 'error'
    state: text("state").notNull().default("uploading"),

    /// 行作成時刻 (= 撮影者「送る」 押下時刻 ≒ 撮影日時)。
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),

    /// processing 中の現在ステップ (= Pipeline 2 の進行表示用)。 'scoring'。
    processingStep: text("processing_step"),

    /// 処理エラー時の最終メッセージ。
    errorMessage: text("error_message"),

    /// WDK workflow の run id (= status query / 手動 cancel 用)。
    workflowRunId: text("workflow_run_id"),

    // ── 撮影ファクト (端末申告 / サーバ算出) ─────────────────────────
    /// 採用された撮影構成 ID (= 'ultra_wide' | 'arkit' | ...、 DATA_SPECS §2.2)。 端末が登録時に申告。
    recordingConfig: text("recording_config").notNull(),

    /// 録画尺 (ms)。 Pipeline 2 の labeling が rgb.mp4 から算出 (= cv2 probe)。 端末申告でも上書き可。
    durationMs: integer("duration_ms"),

    /// ぼかし済 rgb.mp4 のバイト数 (= 端末が登録時に申告)。
    contentSize: bigint("content_size", { mode: "number" }),

    /// 撮影端末の機種 (= utsname machine、 例 "iPhone15,2")。 来歴 / 市場フィルタ用。
    deviceModel: text("device_model"),

    // ── オンチェーン / 来歴 ──────────────────────────────────────────
    /// TP 発行された Root NFT の cNFT asset id (= Bubblegum、 base58)。 Pipeline 2 起動の前提条件。
    rootAssetId: text("root_asset_id").notNull(),

    /// TP /process が返した signed_json への URI (= TEE 署名済メタデータ JSON)。 cNFT 発行と同時に確定。
    signedJsonUri: text("signed_json_uri").notNull(),

    /// Bubblegum delegate (= owner と等しければ unstaked、 異なれば staked)。
    delegate: text("delegate"),

    // ── Pipeline 2 結果 ──────────────────────────────────────────────
    /// 多軸品質ベクトル (= DATA_SPECS §3、 軸名 → {axis, score 0-100, method, breakdown})。 合計は持たない。
    qualityVector: jsonb("quality_vector").$type<QualityVector>(),

    /// クリップの 1 行要約 (= labeling の Gemini 全体パス。 semantic.jsonl ヘッダ summary)。 可読ラベル。
    summary: text("summary"),

    // ── 収益 ─────────────────────────────────────────────────────────
    /// ライセンス販売の集計 (= staked 後に更新)。
    licenseCount: integer("license_count").notNull().default(0),
    revenueUsdc: numeric("revenue_usdc", { precision: 18, scale: 6 }).notNull().default("0"),
  },
  (t) => [
    index("clips_wallet_idx").on(t.walletPubkey),
    index("clips_state_idx").on(t.state),
    index("clips_signature_hash_idx").on(t.signatureHash),
    // 重複排除を DB で保証 (= 同 wallet × 同 signature_hash × 同 network は 1 行)。
    uniqueIndex("clips_wallet_sig_network_uq").on(t.walletPubkey, t.signatureHash, t.network),
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
