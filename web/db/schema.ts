import {
  pgTable, text, integer, bigint, timestamp, index, uniqueIndex, jsonb,
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

/// 同意イベントログ (= document/v0.1.3/legal/consent-log-spec/ja.md が正典)。
///
/// append-only: 同意・再同意・撤回のたびに 1 行追記する。 UPDATE / DELETE は行わない
/// (= 同意の有効性を後から立証する証跡。 撤回も event_type='withdrawal' の追記で表現)。
/// 層化同意の証跡として、 同意対象の正本 (doc) と画面に見せた要約 (summary) の
/// 両方の版 + SHA-256 を残す。
export const consentEvents = pgTable(
  "consent_events",
  {
    /// evt_<uuid> (= server 生成)
    id: text("id").primaryKey(),
    /// 'consent' | 'reconsent' | 'withdrawal'
    eventType: text("event_type").notNull(),
    /// 同意者のアカウント公開鍵 (= X-Account-Pubkey。 subject_id)
    subjectPubkey: text("subject_pubkey").notNull(),
    /// 端末申告の同意時刻 (UTC)
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),

    /// 同意対象の正本 (= 'tester-consent' 等)
    docSlug: text("doc_slug").notNull(),
    docVersion: text("doc_version").notNull(),
    /// 正本全文 (raw md) の SHA-256 hex
    docContentHash: text("doc_content_hash").notNull(),
    /// 画面に表示した層1要約の版
    summaryVersion: text("summary_version").notNull(),
    /// 表示した要約文言 (locale 別) の SHA-256 hex
    summaryHash: text("summary_hash").notNull(),

    /// 同意スコープ (= ['collection','ai_training_use','license_sale','cross_border'])
    scopes: jsonb("scopes").notNull(),
    /// 各チェック項目の真偽 (= { age18_and_location_right, no_third_party, agree_terms })
    checkboxResults: jsonb("checkbox_results").notNull(),

    /// 表示言語 ('ja' | 'en')
    locale: text("locale").notNull(),
    /// 取得方式 (= 'clickwrap')
    consentMethod: text("consent_method").notNull(),
    appVersion: text("app_version"),
    device: text("device"),
    /// 相関情報 (= 対象クリップの local id / 撮影時刻 等。 個人データは入れない)
    context: jsonb("context"),

    /// server 受領時刻
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("consent_events_subject_idx").on(t.subjectPubkey),
    index("consent_events_occurred_idx").on(t.occurredAt),
  ],
);

export type ConsentEvent = typeof consentEvents.$inferSelect;
export type NewConsentEvent = typeof consentEvents.$inferInsert;
