# 13. supabase-auth-accounts

## 目的

端末ローカル鍵 (DebugAuthProvider / `X-Account-Pubkey`) を、 Supabase Auth ベースの
**運営発行アカウント (uuid + パスワード)** に置き換える。 クリップと同意証跡を現場単位の
`account_id` (uuid) に紐づけ、 現場ごとの録画時間集計 (= 撮影協力費の明細) を SQL 一発にする。
あわせて DB を必要十分な 2 テーブルに掃除する。

## 設計の要点 (2026-07-12 合意)

- **アプリは「データを取って id に紐づけるだけの機械」**。 現場名・契約・振込先などの意味論は
  一切サーバに置かず、 運営の台帳 (freee 取引先メモ等) で uuid ↔ 実世界を対応させる。
  店名がアプリ側の DB / クエリ経路に存在しないことが「店名非公表」の約束の構造的保証になる。
- アカウントは**自己登録なし**。 運営が Supabase Admin API で合成メール
  (`<uuid頭8>@rl.local` 等、 PII なし) + パスワードの confirmed ユーザーを発行する。
  **`auth.users.id` (uuid) がアカウントの正式 id**。 ログイン文字列はただの取っ手。
- `kind` / `status` のような**契約状態のシャドウコピーは持たない** (状態が 2 箇所にあると
  必ず食い違う)。 契約終了 = 台帳に記帳 + admin ban / パスワード変更 / セッション失効。
- パスワードハッシュ・トークン失効・総当たり対策は Supabase Auth の責任範囲に外出しする
  (= 認証は自作しない)。
- ログイン UX: uuid 手打ちを避けるため、 発行時にログイン情報入り QR を生成して現場でスキャン。
- 将来の SNS ログイン (Apple/Google) は Supabase Auth のプロバイダ追加で対応可能な形を保つ。

## 読むべきファイル

- `app/src/services/auth/` (AuthProvider 抽象。 ここに SupabaseAuthProvider を差す)
- `app/src/services/consent.ts` + `app/src/dataflow/steps/register.ts` (ヘッダ送信箇所)
- `web/app/api/clips/route.ts`, `web/app/api/v1/raw-uploads/route.ts`, `web/app/api/v1/consents/route.ts`
- `web/db/schema.ts`, `web/drizzle/0003_content_hash_and_account.sql` (migration の流儀)
- `web/lib/clipId.ts` (撤去対象。 コメントに C2PA 残骸あり)
- `document/v0.1.3/legal/consent-log-spec/ja.md` (consent_events の列意味)

## スコープ

### やること

1. **web: API 認証の置換**。 `X-Account-Pubkey` → `Authorization: Bearer <supabase JWT>`。
   全ルート (clips POST/GET, raw-uploads, consents) で JWT を検証し、 `account_id` は token の
   sub から取る (= クライアント申告の id を信じない)。
2. **web: migration 0004** (SQL 直流し方式):
   - `clips`: `content_hash` を PK に昇格 (合成 `id` 列 + `lib/clipId.ts` 撤去)。
     `account_id uuid NOT NULL` 追加。 `account_pubkey` / `state` / `error_message` /
     `updated_at` / 冗長 index (`clips_account_idx`) 撤去。 `consent_event_id text` 追加。
   - `consent_events`: `subject_pubkey` → `account_id` (uuid)。
   - backfill: 既存 clips 76 行 + consent_events 40 行を最初に発行する「自宅」アカウントの
     uuid へ付け替え。
   - **死骸 5 テーブルの DROP**: `cnft_assets`, `device_certificates`, `users`, `pages`,
     `contents`。 実行前に `pg_dump` でアーカイブを取る。 **DROP はユーザーの GO を得てから**。
3. **app: SupabaseAuthProvider** を AuthProvider 抽象に実装 (supabase-js)。 セッションは
   expo-secure-store (Keychain) に永続化。 `AuthSession.pubkey` → `accountId` に改名。
4. **app: ログイン画面** (id + パスワード入力、 QR スキャン対応)。 API 送信ヘッダを Bearer に。
5. **tools: アカウント発行スクリプト** (`tools/` 配下)。 合成メール + 初期パスワード生成 →
   service role で confirmed ユーザー作成 → ログイン QR (PNG) 出力。 出力された uuid を
   台帳に転記するところまでが運用手順。
6. **clips.consent_event_id の配線**: `recordUploadConsent` の返り値 id を POST /api/clips に
   渡して行に保存 (= クリップ ⇔ 同意証跡の結合をタイムスタンプ推測から外部キーに硬化)。

### やらないこと

- SNS ログインの実装 (将来タスク)
- 現場名・契約情報・振込先などのメタデータをサーバに置くこと (恒久方針)
- RLS の本格導入 (API は service role 経由のまま。 端末が DB を直接触る経路は作らない)
- 旧端末鍵 (DebugAuthProvider の秘密鍵) の掃除 (残っても害なし。 Provider 自体は dev 用に残す)
- Supabase Auth のメール系機能は使わない (確認メール / リセットメールは設定で無効化)

## 成功基準

- 実機: 発行済み uuid + パスワードでログイン → 録画 → 同意 → アップロードが Bearer 経由で通り、
  `clips` 行に `account_id` と `consent_event_id` が入る。
- 明細クエリ: `select account_id, date_trunc('month', created_at), sum(duration_ms) group by 1,2`
  が現場別に出る。
- DB: public スキーマのテーブルが `clips` / `consent_events` の 2 つだけになる。
- サーバ側のどこにも店名・実メールアドレスが存在しない。

## 進捗

- [ ] 未着手
