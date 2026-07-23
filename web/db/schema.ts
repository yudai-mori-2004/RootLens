import {
  pgTable, text, integer, bigint, timestamp, index, jsonb, uuid,
} from "drizzle-orm/pg-core";

// v0.1.4: 「データを取って id に紐づけるだけの機械」 の最小 schema。
//
// public スキーマは clips / consent_events / accounts の 3 テーブル。 アカウントの実体は
// Supabase Auth (auth.users) が持ち、 accounts はその撮影運用属性 (domain / site の匿名コード)
// だけを載せる。 店名・契約・振込先などの実世界対応は一切 DB に置かず、 運営の台帳
// (freee 取引先メモ等) で uuid ↔ 実世界を対応させる (= 店名非公表の構造的保証。
// 詳細は document/v0.1.4/tasks/13-supabase-auth-accounts/)。

export const clips = pgTable(
  "clips",
  {
    // ── 識別・所有 ───────────────────────────────────────────────────
    /// raw mp4 バイト列の SHA-256 hex。 端末で計算し、 R2 raw キーと
    /// 完全に 1:1 (= raw/<content_hash>/*)。 ストレージが内容アドレスで世界一意なので DB も同じ。
    contentHash: text("content_hash").primaryKey(),

    /// 撮影アカウント (= auth.users.id)。 検証済み JWT の sub からのみ書かれる。
    accountId: uuid("account_id").notNull(),

    /// このクリップのアップロード同意イベント (= consent_events.id)。 クリップ ⇔ 同意証跡の結合。
    consentEventId: text("consent_event_id"),

    /// 行作成時刻 (= 登録 ≒ アップロード完了時刻)。
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    /// 録画開始時刻 (= raw rgb.mp4 の QuickTime mvhd creation_time、 UTC)。 撮影から
    /// アップロードまで数十時間空くことがあるため created_at とは別に持つ。
    /// 納品パイプラインが raw を読むついでに埋める (nullable = まだ読んでいない)。
    recordedAt: timestamp("recorded_at", { withTimezone: true }),

    // ── 撮影ファクト (端末申告) ───────────────────────────────────────
    /// 採用された撮影構成 ID (= 'ultra_wide' | 'arkit')。
    recordingConfig: text("recording_config").notNull(),

    /// 録画尺 (ms)。 端末申告。 現場 × 月の録画時間集計 (= 撮影協力費の明細) の元。
    durationMs: integer("duration_ms"),

    /// rgb.mp4 (= raw、 blur 無し) のバイト数。
    contentSize: bigint("content_size", { mode: "number" }),

    /// 撮影端末の機種 (= utsname machine、 例 "iPhone15,2")。 来歴用。
    deviceModel: text("device_model"),
  },
  (t) => [
    // GET /api/clips (= account 別一覧) と明細集計 (account × 月) 用。
    index("clips_account_id_idx").on(t.accountId),
  ],
);

export type Clip = typeof clips.$inferSelect;
export type NewClip = typeof clips.$inferInsert;

/// 撮影アカウントの現場属性 (= 納品 manifest の domain / site の正)。 id は auth.users.id。
/// site は "bakery-01" のような匿名コードのみ (実世界との対応は台帳側に置く)。
/// 行が無いアカウント (テスト端末など) のクリップは納品パイプラインが実行前に拒否する。
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey(),
  domain: text("domain").notNull(),
  site: text("site").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Account = typeof accounts.$inferSelect;

/// 同意イベントログ (= document/legal/consent-log-spec/ja.md が正典。
/// task 13 での差分: subject の識別子を pubkey から account_id (uuid) に置換)。
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
    /// 同意者のアカウント (= auth.users.id。 検証済み JWT の sub)
    accountId: uuid("account_id").notNull(),
    /// 端末申告の同意時刻 (UTC)
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),

    /// 同意対象の正本 (= 'terms-of-service' 等)
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
    /// 各チェック項目の真偽 (= { location_permission, no_third_party, terms_agreed })
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
    index("consent_events_account_idx").on(t.accountId),
    index("consent_events_occurred_idx").on(t.occurredAt),
  ],
);

export type ConsentEvent = typeof consentEvents.$inferSelect;
export type NewConsentEvent = typeof consentEvents.$inferInsert;
