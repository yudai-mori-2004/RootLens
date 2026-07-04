import {
  pgTable, text, integer, bigint, timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";

// v0.1.4: 「ただのカメラ計測アプリ + raw アップロード入口」 への簡素化版。
// 詳細は document/v0.1.4/DATA_SPECS_JA.md。
//
// 1 クリップ = 1 行。 列は (識別 / ライフサイクル / 撮影ファクト) の最小集合のみ。
// 後段 (blur / scoring / labeling / mint / staking) は v0.1.4 では行わないので、
// 関連列 (rootAssetId / signedJsonUri / qualityVector / summary / delegate / licenseCount /
// revenueUsdc / processingStep / workflowRunId) は撤去済み (= 0001_v0_1_4_simplify.sql)。
// v0.1.5 で後段ワーカーを再配線する時は、 別テーブル / 別 schema として追加する想定。
//
// 重複排除キー (wallet_pubkey, signature_hash, network) は UNIQUE 制約で DB が保証する。

export const clips = pgTable(
  "clips",
  {
    // ── 識別・所有 ───────────────────────────────────────────────────
    /// 内部 ID (= 端末指定 UUID、 または server 生成)。 不変。
    id: text("id").primaryKey(),

    /// 撮影者の Solana wallet pubkey (base58)。
    walletPubkey: text("wallet_pubkey").notNull(),

    /// C2PA D1 アクティブマニフェスト署名の SHA-256 hex (= DATA_SPECS §1.1)。
    /// 端末で確定し、 raw/ の dir キーとして使う。
    signatureHash: text("signature_hash").notNull(),

    /// Solana ネットワーク (= "devnet" | "mainnet")。 v0.1.4 では mint をしないので
    /// 記録のみだが、 後段ワーカー (v0.1.5+) が mint する時の宛先として残す。 重複排除キーの一部。
    network: text("network").notNull().default("devnet"),

    // ── ライフサイクル ───────────────────────────────────────────────
    /// DATA_SPECS §4 の状態。 'uploading' | 'uploaded' | 'error' の 3 値のみ。
    state: text("state").notNull().default("uploading"),

    /// 行作成時刻 (= 撮影者「送る」 押下時刻 ≒ 撮影日時)。
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),

    /// アップロード失敗時のエラーメッセージ (= error 状態時のみ非 null)。
    errorMessage: text("error_message"),

    // ── 撮影ファクト (端末申告) ───────────────────────────────────────
    /// 採用された撮影構成 ID (= 'ultra_wide' | 'arkit'、 DATA_SPECS §2.2)。 端末が登録時に申告。
    recordingConfig: text("recording_config").notNull(),

    /// 録画尺 (ms)。 端末申告。
    durationMs: integer("duration_ms"),

    /// rgb.mp4 (= C2PA D1 署名済、 blur 無し) のバイト数。
    contentSize: bigint("content_size", { mode: "number" }),

    /// 撮影端末の機種 (= utsname machine、 例 "iPhone15,2")。 来歴用。
    deviceModel: text("device_model"),
  },
  (t) => [
    index("clips_wallet_idx").on(t.walletPubkey),
    index("clips_signature_hash_idx").on(t.signatureHash),
    // 重複排除を DB で保証 (= 同 wallet × 同 signature_hash × 同 network は 1 行)。
    uniqueIndex("clips_wallet_sig_network_uq").on(t.walletPubkey, t.signatureHash, t.network),
  ],
);

export type Clip = typeof clips.$inferSelect;
export type NewClip = typeof clips.$inferInsert;

/// ToS 同意ログ。 1 wallet × 1 tos_version で 1 行。
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
