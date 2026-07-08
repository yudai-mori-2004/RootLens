# 12. C2PA / Title Protocol / Solana 残骸の全撤去 + Modal pipeline 再編

## 目的

タスク 08 (deblockchain-cleanup) と 09 (remote-signing) の続き。
v0.1.4 の実像 (= FPV Labs 向けデータ収集 + EgoBlur ぼかし + Stera 互換 MCAP 手渡し) に対して
不要になった以下を全て抹消し、 リポを「今の仕様をゼロベースで組んだような」 状態にする:

1. **C2PA 署名インフラ全部** (2026-07-06 時点で「もう売りでもなんでもない、 いらない」 と確定)。
   タスク 09 で入れたリモート署名 API と、 タスク 03 で残していた D1 署名ステップの両方が対象。
2. **Title Protocol / cNFT / Solana on-chain 一切**。 タスク 08 は wallet/mint/staking の**アプリ側 UI**
   を消したが、 サーバ側の verify pipeline と Anchor プログラム本体 + LP の 検証ページは残っていた。
   これらは 「v0.1.5 の mint 再配線用に残置」 と task 07 §6 で明記されていたが、 2026-07-09 に
   ユーザ判断で v0.1.5 の mint 予定自体を廃棄。 全部消せる。
3. **識別子改名**: `signature_hash` (= C2PA D1 署名の SHA-256) → `content_hash` (= raw mp4 の SHA-256)、
   `wallet_pubkey` → `account_pubkey`、 `network` 列削除、 `tos_consents` テーブル削除。
4. **Modal パイプラインの再編**: `tools/modal/` 直下に散らばっている 「Pipeline 1/2/3」 の謎ナンバリング
   ファイル群を `score-wilor/` と `fpvlabs/` の 2 ディレクトリに分けて、 今後 N 本のパイプラインを
   横並びで追加できる形にする。 中央パイプラインは fpvlabs (= 現在の実運用)。 score-wilor は
   脆弱で古いが履歴として残す。
5. その他: mock-device / smoke-test / macos-blur / privacy-blur モジュール / 廃止済 gtsam_eval など、
   もはや caller がいない実験ツール群も撤去。

履歴は git にあるので物理削除で良い。

## 前提 (2026-07-09 ユーザ判断)

このタスクを開くに至った user 発言 (要約):

- 「TPとか、 もはや今は使っていませんよ。 nftもないです」 (2026-07-09)
- 「もう、 c2paはもはや売りでもなんでもない、 いらない」 (2026-07-06)
- 「アプリ側の署名処理を全部根こそぎなくす」 (2026-07-09、 本タスク起票の直接の指示)
- 「パイプラインは、 n本用意できるようにしたい。 今はなぜか 1 つのパイプラインのコードが、 1,2,3
  みたいな謎のナンバリングをつけられて直下に散らばってて最悪」 (2026-07-09)
- 「オンデバイスblurはもうやらない」 (2026-07-09)
- 「keysdirは、 消したらもう復元できないのが怖いから、 なんかとっておきたく思う」 (2026-07-09)

これらを踏まえた個別判断は下の「設計判断」 に落とし込む。

## 読むべきファイル

- `AUDIT.md` (このタスクの隣) — Opus エージェントによる全ファイル読破監査の生レポート。 削除対象・
  編集対象・ 順序・ 影響範囲・ 曖昧項目を全て列挙している。 このタスクの実装は AUDIT.md の記述を
  正として進める。 本 README は方針と scope の要約。
- `AUDIT-ADDENDUM.md` (このタスクの隣) — AUDIT.md 生成直後、 user 指摘 (「license-nft の
  ファイルがまだ残ってる。 もう一回全部監査してくれ」) を受けて回した 2 回目の Opus 監査の差分。
  15 件の新規発見 + 1 件の訂正 + PR 順序更新 (10 PR → 12 PR、 6.5 = native/jarosz-wasm、
  8.5 = 孤児 sensors/units) + 各 PR 後の grep 検証コマンド。 実装時は AUDIT.md と併読する。
- `document/v0.1.4/tasks/08-deblockchain-cleanup/README.md` — 前段。 何が既に消えて何が残ったか。
- `document/v0.1.4/tasks/09-remote-signing/README.md` — 前段。 このタスクで消される対象。
- `document/v0.1.4/tasks/07-manual-upload-landscape-arkit/README.md` §6 — 「v0.1.5 の mint 再配線
  のため programs/crates を残す」 と書かれた記述。 このタスクで無効化する。
- `document/v0.1.4/DATA_SPECS_JA.md` — 空なので、 このタスクで v0.1.4 の実像に合わせて埋める。
- `CLAUDE.md` — Pipeline 1/2/3 テーブル、 「TP register + cNFT 発行は Pipeline 1 末尾」 の設計判断、
  「rootAssetId」 「オフチェーンストレージ」 の記述などを全書き換え。
- `README.md` (repo root) — C2PA / Root NFT / Solana / License NFT の記述を全撤去。

## 設計判断

### 1. `signature_hash` → `content_hash` に改名 (実質は SHA-256 of raw mp4)

- 現状: `signature_hash` = SHA-256(C2PA D1 active manifest signature)。 C2PA を消すと定義が消える。
- 新: `content_hash` = SHA-256(raw mp4 bytes)。 端末 → サーバ → R2 の全域で同じ値をキーに使う。
- R2 raw キー: `raw/<content_hash>/rgb.mp4` (パス構造は同じ、 値の意味だけ変わる)。
- 既存の `raw/<signature_hash>/*` は R2 に orphan として残る (= 削除しない、 参照だけ切る)。
- fpvlabs 出力キー `<hash>/session.mcap` も新命名に追従。

**計算方法**: 端末で mp4 全バイトを SHA-256 する。 3-4 GB の mp4 でも 500ms 以内で計算できる
(Rust FFI or 分割ハッシュ)。 native/c2pa-bridge を消す代わりに小さい `sha256_of_file` FFI stub を残す
選択肢もあるが、 まずは `expo-crypto` + streaming で行けるか確認する。

### 2. `wallet_pubkey` → `account_pubkey` に改名

タスク 08 で「後で改名する」 と保留された分。 DB カラム名も追従。 API header (`X-Wallet-Pubkey`)
は既に task 08 で `X-Account-Pubkey` に切り替え済み、 legacy fallback を今回のタスクで完全削除。

### 3. `network` 列と `tos_consents` テーブル削除

- `network`: v0.1.5 の mint 先を記録するために残していた。 v0.1.5 の mint 自体が消えるので不要。
- `tos_consents`: task 11 で `consent_events` に置き換えたが、 テーブル本体が残っていた。

### 4. Modal パイプラインを 2 ディレクトリに再編

**現状**:
```
tools/modal/
  layer1_metadata.py, layer2_frame_sampling.py, layer3_vlm.py,
  wilor.py, pipeline2.py, gtsam_eval.py,
  labeling/, preprocess/, scoring/, r2ctx.py,
  fpvlabs.py
```

**新**:
```
tools/modal/
├── score-wilor/       # 旧 Pipeline 2 (自動採点 3 層) + 旧 Pipeline 3 (WiLoR)。 現運用外だが履歴として残す
│   ├── layer1_metadata.py
│   ├── layer2_frame_sampling.py
│   ├── layer3_vlm.py
│   ├── wilor.py
│   ├── pipeline2.py
│   ├── r2ctx.py
│   ├── labeling/
│   ├── preprocess/
│   └── scoring/
└── fpvlabs/           # FPV Labs (Stera) 手渡し。 EgoBlur + Stera 互換 MCAP。 現運用の中心
    └── fpvlabs.py
```

- Pipeline 1/2/3 の 3 段構成は思想的に破棄。 「N 本並列に生きるパイプライン」 という認識に変える
  (中央パイプラインが存在するという前提をやめる)。
- `gtsam_eval.py` は CLAUDE.md 61行目で「廃止」 明記済 → 削除。
- 移動に伴う import path 変更は Modal deploy 経由で反映 (= 移動先に対して再 `modal deploy` する)。

### 5. C2PA D1 署名を完全に廃止

- 端末: 録画 → (D1 署名を挟まず) content_hash 計算 → R2 raw アップロード → `POST /api/clips`。
- サーバ: `/api/v1/c2pa-sign` エンドポイント削除、 組織鍵 (`C2PA_SIGN_KEY_B64`) も env から削除。
- native/c2pa-bridge crate、 app/modules/c2pa-bridge (iOS+Android module + 400MB jar/`.a`)、
  app/src/native/c2paBridge.ts、 app/src/dataflow/steps/sign.ts、 web/lib/c2pa-certs.ts 全消し。
- タスク 09 で入れた PublicKey PEM チェーン 3 種の env (`ROOT_CA_CERT_PEM` 等) も削除。

### 6. Web verify pipeline + 検証ページを完全に廃止

- `web/lib/verify/` (TP verify SDK 呼び出し、 PDQ/vPDQ 計算、 cert chain 検証、 core-c2pa 検証)、
  `web/lib/data.ts` / `web/lib/types.ts` / `web/lib/supabase.ts` / `web/lib/server/page-store.ts` /
  `web/lib/server/r2.ts` — 全撤去。
- 公開 verify ページ `/[addressOrUsername]`、 `/p/[shortId]`、 `/why-blockchain`、 `/legal-basis`、
  `/delete-account` — 削除 (delete-account だけは App Store 審査で必須なので、 clips + consent_events
  を drizzle 経由で消す小さいルートに書き直して残す)。
- LP 側の `ContentPage.tsx`、 `CreatorPage.tsx`、 `WhyBlockchainPage.tsx`、 `LegalBasisPage.tsx`、
  `DeleteAccountPage.tsx` — 削除。
- 依存 npm パッケージ 11 個 (`@solana/web3.js`、 `@title-protocol/sdk`、 `@aws-sdk/client-kms`、
  `@peculiar/asn1-schema`、 `@peculiar/x509`、 `asn1js`、 `bs58`、 `canonicalize`、 `cbor-x`、
  `mp4box`、 `sharp`) を web/package.json から削除。 詳細は AUDIT.md §12。

### 7. Anchor programs + license-cli + テスト削除

- `programs/license-nft/` (Anchor プログラム)、 `crates/cli/` (license-cli Rust CLI)、
  `tests/license-nft/`、 `tests/staking/`、 `Anchor.toml`、 root `Cargo.toml`、 `network.json` — 全撤去。
- root `Cargo.toml` は workspace 定義しか持っていない (mock-device と native/c2pa-bridge は
  独自 `[workspace]` で breakerがある)。 削除後 `cargo` が root で反応しなくなるだけ。

### 8. mock-device / smoke-test / macos-blur / privacy-blur / gen-dummy-sensors 削除

- `tools/mock-device/` (v0.1.3 用の Rust CLI、 現サーバ contract と非互換で復元価値なし)
- `tools/smoke-test.sh` (mock-device に依存する e2e スクリプト)
- `tools/gen-dummy-sensors.py` (mock-device に食わせる偽 IMU + 手ポーズ JSONL 生成器、 単体では無意味)
- `tools/macos-blur/` (mock-device から呼ばれる Apple Vision blur、 mock-device と一緒に caller 消失)
- `app/modules/privacy-blur/` (iOS ネイティブ Swift オンデバイスぼかし) + `app/src/units/privacy-blur/`
  (JS ラッパ)。 現行フローで呼ばれておらず、 「オンデバイス blur はもうやらない」 の user 判断で確定廃止。

### 9. `keys/` は物理削除しない

- `keys/dev/solana/deployer.json` などは復元不可 (旧 Anchor deploy 鍵)。 `.gitignore` 済みで git には
  入っていないので、 ローカル HDD にそのまま残す。 user が手動で判断する場合のみ削除。

### 10. LP は放置

- `/sample`、 `/sample/v0.1(.3)`、 `web/public/lp/sample/`、 `tools/lp-sample/` は継続 (`/sample` LP を
  出し続けるため)。
- HomePage.tsx / `web/app/page.tsx` / `SiteLayout` / `NavBar` / `SiteFooter` は「文章書き換えが大変」
  の理由で今回は触らない (= Solana 言及が残るが、 目的の「dead code の抹消」 に対しては優先度低)。
- `web/app/safety/page.tsx`、 `web/app/privacy/page.tsx` も同じ理由で放置 (contact@titleprotocol.org
  の誤記だけは適宜見直し)。

## スコープ

### やること

以下を AUDIT.md の順序に従い 10 PR に分けて実装。 詳細な file:line は AUDIT.md §2〜§7 参照。

1. **docs 更新**: README.md、 CLAUDE.md、 web/public/llms.txt、 web/public/robots.txt を v0.1.5 の
   ビジョン (データ収集 + FPV 手渡し、 C2PA/blockchain 無し) に書き換え。 `document/v0.1.4/DATA_SPECS_JA.md`
   にも今の実像を反映。
2. **web LP verify surfaces 削除**: `web/lib/verify/`、 `web/lib/data.ts`、 `web/lib/types.ts`、
   `web/lib/supabase.ts`、 `web/lib/server/page-store.ts`、 `web/lib/server/r2.ts`、 verify ページ 5 枚、
   LP 用 verify component 5 個、 `web/scripts/{build-license-json,debug-verify,verify-video,transparentize}` 削除。
   `web/public/licenses/`、 `web/public/.well-known/tdm.json` 削除。 `web/messages/{ja,en}.json` から
   関連キー削除。 web/package.json から 11 個の依存削除。 `web/app/api/v1/delete-account/route.ts` を
   drizzle 版に書き直し。 web build green を確認。
3. **WDK workflow 足場削除**: `web/app/.well-known/workflow/v1/` 全消し、 `next.config.ts` から
   `withWorkflow` 撤去、 `workflow` 依存削除。
4. **Anchor programs + license-cli + tests 削除**: §7 に列挙。 root `.gitignore` から Solana 関連ブロック
   を撤去。
5. **mock-device + smoke-test + gen-dummy-sensors + macos-blur 削除**: §8 に列挙。
6. **CLAUDE.md 最終形**: Pipeline 1/2/3 のテーブル、 TP register + cNFT の設計判断セクション、
   「オフチェーンストレージ」 節を全て削除・置換して現状 (fpvlabs pipeline + score-wilor legacy) を反映。
7. **app 依存整理**: `@title-protocol/sdk`、 `viem` を `app/package.json` から削除。 `bs58` は
   DebugAuthProvider が使っているので残す。
8. **DB migration + `signature_hash → content_hash` 系 rename (breaking)**: AUDIT.md §4 の
   `0003_deblockchain_and_content_hash.sql` を作成 + web/app 側で全ての identifier rename。 順序は
   コード先→migration 適用→web deploy→app build ship の順で、 5 分の service window を許容する。
9. **C2PA D1 subsystem 完全削除**: §5 に列挙。 app 側で `sha256_of_file` を新規実装 (native FFI か
   expo-crypto の streaming) して sign step の空きを埋める。
10. **Modal パイプライン再編**: `tools/modal/` 直下の score-wilor 一味を `tools/modal/score-wilor/` に、
    fpvlabs を `tools/modal/fpvlabs/` に移動。 `gtsam_eval.py` 削除。 `tools/fpvlabs-handoff/list_pending.py`
    と RUNBOOK の `modal run` パスを新場所に更新。 Modal deploy を新 path で 1 回打つ。

### やらないこと

- `document/v0.1.0` / `v0.1.1` / `v0.1.2` / `v0.1.3` の spec の編集 (= 過去仕様は凍結)。
- `keys/` ディレクトリの物理削除。
- `web/app/page.tsx` (HomePage) の書き換え、 `SiteLayout` / `NavBar` / `SiteFooter` の書き換え、
  `/safety` / `/privacy` ページの書き換え。 Solana 語彙が LP に残っても許容 (user 判断)。
- `/sample` LP の削除、 `tools/lp-sample/` の削除、 `web/public/lp/sample/` の削除 (継続方針)。
- Modal `score-wilor/` の中身の削除 (脆弱で古いが履歴として残す)。
- 既存の R2 `raw/<signature_hash>/...` オブジェクトの削除 (orphan として放置、 参照だけ切る)。
- `../rootlens-mobile/` (兄弟リポ) との差分整理。
- Pipeline 2/3 の Modal deployment は既に task 05 で teardown 済み。 このタスクではローカルコードの
  移動のみで、 deployment の削除は無い。

## 順序と依存

AUDIT-ADDENDUM.md §5 の **12 PR** (AUDIT.md の 10 PR + 6.5 と 8.5 を追加) で進める。
PR 間の依存は最小化されているが、 以下だけ厳守:

- PR 8 (DB migration + rename) はコード変更が全部載る breaking PR。 独立して合流させる。
- PR 8.5 (孤児 sensors/units 削除) は PR 8 の後 (もしくは無関係、 独立)。
- PR 9 (C2PA D1 + AesGcm 削除) は PR 8 の後 (rename 済のコードベースを触るので)。
- PR 10 (Modal 再編) は他 PR と独立、 いつでも入れられる。
- PR 6.5 (native/jarosz-wasm 削除) は完全独立、 いつでも入れられる。
- PR 1〜7 は互いに独立、 並行可。

## 成功基準

- 各 PR 適用後に AUDIT-ADDENDUM.md §6 の grep コマンドを走らせて残骸ゼロを確認する。
- `grep -rE '(c2pa|C2PA|title.protocol|cNFT|Solana|signature_hash|wallet_pubkey|rootAssetId|signedJsonUri|AesGcm|jarosz)' .`
  で残るのは `document/v0.1.0-v0.1.3/`、 過去タスク README、 `references/`、 履歴用途の一部だけ。
- `git ls-files | wc -l` が 667 → 500 前後に減る (= AUDIT-ADDENDUM.md 想定)。
- `web/` `pnpm typecheck` + `next build` green。 依存 11 個削除後も build 通る。
- `app/` `pnpm typecheck` + iOS/Android build 通る。 sign step が消えても capture → upload flow が動く。
- `POST /api/clips` の contract が `contentHash` (SHA-256 of raw mp4) を受け取る形。
- `tools/modal/` 直下に `score-wilor/` と `fpvlabs/` の 2 サブディレクトリのみ (他は削除 or 移動済)。
- `README.md`、 `CLAUDE.md`、 `web/public/{llms,robots}.txt` が現状 (FPV データ収集) を反映。
- `modal run tools/modal/fpvlabs/fpvlabs.py --signature-hash <hash>` が今まで通り動く (RUNBOOK 更新済み)。

## 進捗

未着手。 このタスクは別セッションで小分け PR として進める (= 現セッションのコンテキストが重い、
かつ影響範囲が広いので新鮮なコンテキストが望ましい)。

## 補足

- AUDIT.md はエージェント (opus) が全ファイル読破 (221 tool calls / 566K tokens / 16 min) して
  生成した監査レポートの生コピー。 削除対象の file:line、 impact map、 ambiguity list を含む。
  実装時はこの AUDIT.md を正として、 本 README は「なぜ」 と「粒度の切り方」 だけ提供する立場。
- Cleanup 実行時、 途中で新たな不明点が出たら AUDIT.md に追記して残す (= 次に触る人が同じ調査を
  やり直さないため)。
