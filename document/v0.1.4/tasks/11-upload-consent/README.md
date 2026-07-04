# 11. アップロード同意フロー (= 層化同意 + consent-log-spec 実装)

## 目的

アップロード前の同意を「チェック 1 個 + 即アップロード」 から、 法的に十分な水準の
2 段フローに引き上げる: **同意フォーム → (同意イベント記録成功) → 動画確認 + アップロード**。
正典は `document/v0.1.3/legal/` の tester-consent (層化同意) と consent-log-spec (記録仕様)。

## フロー (= ClipPreviewModal の 2 段構成)

```
カードタップ
  → Step 1 同意フォーム
      左: 層1 要約 (tester-consent §2 のアップロード適合版、 非拘束の旨を明示)
          + 「利用条件を読む (全文)」 → LegalDocModal (= 層2 正本。 同意は正本全文に成立)
      右: 統合 1 チェック (= 2026-07-04 ユーザー判断で 3 → 1 に簡素化。 チェック文言が
          「18 歳以上 + 撮影場所の権利 / 第三者・子ども不在 / 正本全文への同意 (社外提供・
          販売、 越境含む)」 の 3 表明を全部含む。 checkboxResults は { combined_consent })
      「同意して進む」 = 全チェック時のみ活性。 押下で同意イベントを
      POST /api/v1/consents に記録し、 **成功したときだけ** Step 2 へ
  → Step 2 動画確認
      ローカル mp4 再生 + 「✓ 同意を記録しました」 + アップロードする / 削除 (確認ダイアログ) / 閉じる
```

## 同意イベント記録 (= consent-log-spec 準拠)

- DB: `consent_events` (= 0002_consent_events.sql、 **append-only**。 UPDATE/DELETE 経路なし)
- endpoint: POST /api/v1/consents (subject は X-Account-Pubkey、 zod 検証、 evt_uuid 発番)
- 層化同意の証跡:
  - 正本 (層2): docSlug='tester-consent'、 docContentHash = 正本 raw md の SHA-256
    (= gen-legal.mjs が生成時に確定、 legalDocs.generated.ts が保持)、 docVersion = 'draft-<hash8>'
  - 要約 (層1): summaryVersion = services/consent.ts の UPLOAD_CONSENT_SUMMARY_VERSION、
    summaryHash = 表示 locale の要約文言 (i18n キー列を表示順連結) の SHA-256
    ⚠ **要約の文言 (upload.consent* キー) を変えたら SUMMARY_VERSION を必ず上げる**
  - scopes = collection / ai_training_use / license_sale / cross_border
  - checkboxResults = { combined_consent } (= 統合 1 チェック。 文言が 3 表明を含む)
  - locale / consentMethod='clickwrap' / appVersion / device / context (クリップ相関)

## 実装メモ

- app/src/services/consent.ts が記録の一元実装 (= @noble/hashes で summary hash)。
- LegalDocModal に supportedOrientations 追加 (= 横持ちアプリでの全文表示)。
- 旧 tos_consents テーブルは旧仕様の残骸 (= 未使用)。 仕様書練り直し時に整理。
- 撤回 (event_type='withdrawal') は endpoint / スキーマは対応済み、 UI は未実装 (= 将来)。

## 進捗

- [x] consent_events schema + 0002 migration + POST /api/v1/consents
- [x] services/consent.ts (層化同意の証跡 + summary hash)
- [x] ClipPreviewModal 2 段化 + LegalDocModal 全文導線
- [x] i18n (ja/en、 tester-consent §2 準拠の要約 + 3 チェック)
- [x] 実機スクショで Step 1 / Step 2 検証
- [ ] migration 本番適用 + endpoint 実測
- [ ] 実機で同意 → 記録 → アップロード一連
