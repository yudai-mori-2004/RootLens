# AUDIT Addendum — 2026-07-09 再監査差分

> 由来: `AUDIT.md` に対する 2 回目の Opus 監査 (2026-07-09、 75 tool calls / 178K tokens / 14 min)。
> AUDIT.md 生成直後、 「license-nft のファイルがまだ残ってる。 もう一回全部監査してくれ」 という
> user 指摘を受け、 差分・見落とし・訂正のみを抽出したもの。
> AUDIT.md 本体は変更せず、 このファイルを併読前提で使う。 実装時はどちらも参照する。

## 1. 前回 AUDIT.md の網羅性

667 tracked files を再走査し、 前回 AUDIT.md §2 「Delete outright」 に列挙された削除対象 130+ の
うちサンプルした 59 件を実在確認 → **59/59 全部が今も disk 上に残っている** (= 一切消えていない、
plan 段階のまま)。 削除ラインナップ自体は今なお有効。

## 2. 前回 AUDIT.md の訂正 (1 件)

**`.DS_Store` の tracked 件数**: AUDIT §2 「Root-level cruft」 で「12 tracked、 gitignored-and-purged」
と書かれていたが、 実測 `git ls-files | grep DS_Store` は 0 件。 全て `.gitignore:7` で除外済み。
git action 不要、 `find . -name .DS_Store -delete` でローカル削除するだけ。

## 3. 新規発見 (前回 AUDIT.md が漏らしていた 15 件)

### F1. `native/jarosz-wasm/` — 完全な孤児クレート

- 27 tracked files、 全て `target/` 配下のビルド成果物 (`.wasm`, `.rmeta`, `.rlib`, `.fingerprint/*`)。
- source コード (src/) は存在しない、 呼び出し元も codebase になし
  (`web/lib/verify/pdq.ts:19` はコメント参照のみ)。
- 原因: `.gitignore:41` が `native/c2pa-bridge/target/` のみ対象、 `native/jarosz-wasm/target/` を
  拾えていない → build 成果物がリポに漏れ込んだ。
- **アクション**: `native/jarosz-wasm/` 全消し + `.gitignore` に `native/*/target/` (or `**/target/`) 追加。

### F2. `app/src/sensors/` — 完全な孤児 TypeScript ディレクトリ

- 6 files: `captureFlow.ts` (5463 B、 1 行目 `C2paAssertion` import)、 `SensorSession.ts` (3978 B)、
  `registry.ts` (7934 B)、 `ISensor.ts` (1332 B)、 `DeviceInfoSensor.ts` (3223 B)、 `types.ts` (4015 B)。
- v0.1.0/v0.1.1 の抽象化残骸 (= 現行の `arkit-capture` / `wide-capture` recording-config で置換済)。
- **外部の import 元ゼロ**を実測確認。 ディレクトリごと削除。

### F3. `app/src/native/sensorSession.ts` — F2 経由でのみ参照

- 唯一の importer が F2 の `app/src/sensors/registry.ts:21`。 F2 と一緒に消える。

### F4. `app/modules/sensor-session/` — 遷移的に死んだネイティブモジュール

- iOS: `SensorSessionModule.swift`、 `PreviewView.swift`、 `sensor_session.podspec`、
  `sensors/` (5 Swift files)。
- Android: `SensorSessionModule.kt`、 `PreviewView.kt`、 `sensors/` (6 Kotlin files)、
  `stream/StreamRecorder.kt:69` に C2PA コメントあり。
- JS wrapper (F3) が死んだので遷移的に死。 `app/ios/Podfile.lock` に 4 hits あるので pod cleanup が要る。
- Android 側は `MainApplication.kt` に `packages.add(SensorSessionPackage())` が **無い** ので
  実質未リンク状態。
- **判断**: 削除推奨。 v0.1.5 で IMU capture 用に復活の可能性があるなら残す (要 user 確認、 §I 参照)。

### F5. `app/android/app/src/main/java/io/rootlens/app/AesGcm{Module,Package}.kt`

- TP 暗号化アップロード用の AES-256-GCM ネイティブモジュール。
- `MainApplication.kt:29` で `packages.add(AesGcmPackage())` として登録済。
- **JS 側の consumer ゼロ** (`app/src/` からの `AesGcm*` 呼び出し実測 0 件)。 完全に死。
- 両ファイル削除 + `MainApplication.kt:29` から `packages.add(AesGcmPackage())` を撤去。

### F6. `app/ios/RootLens/AesGcmModule.swift` + `AesGcmModule.m`

- F5 の iOS 対応、 `@objc(AesGcmBridge)` 公開。 JS 側 consumer ゼロ。
- `.xcodeproj/project.pbxproj` の参照要確認 (直接 grep 0 hit なので pod 経由の可能性)。

### F7. `app/src/units/privacy-blur/index.ts` — 呼び出し元ゼロ

- `processPrivacyBlur` を export しているが `app/src/` 内で誰も呼んでいない。
- AUDIT §2 は `app/modules/privacy-blur/` (ネイティブ) は挙げていたが、 この JS ラッパは漏れ。
- privacy-blur モジュール削除と同じ PR で消す。

### F8. `app/dev-certs/` (disk 上、 gitignored)

- 5 個の dev-only C2PA cert (`dev-chain.pem`、 `dev-device-key.pem`、 `dev-device.pem`、
  `dev-root-ca-key.pem`、 `dev-root-ca.pem`)。
- `.gitignore:38` で除外済なので git action は不要、 `rm -rf app/dev-certs` でローカル削除。

### F9. `web/vercel.json` の cron が死んでる

- `web/vercel.json:1-8` に `path: "/api/v1/indexer/poll"` の daily cron が定義されているが、
  該当 endpoint は disk 上に存在しない (= `web/app/api/v1/indexer/` ディレクトリなし)。
- Vercel は毎日 404 を叩き続けている。
- crons ブロック削除、 crons ブロックが唯一の内容なので **`web/vercel.json` ごと削除**でも良い。

### F10. `app/scripts/gen-legal.mjs` と `web/scripts/gen-legal.mjs` の内容不整合

- 両方 `document/v0.1.3/legal/*.md` から `legalDocs.generated.ts` を生成する仕組み。
- **app 側は古い**: 「映像と音声」 (現仕様は video-only) の記述が残る、 かつ両方に NFT/blockchain 言及。
- ソース (`document/v0.1.3/legal/*.md`) を更新した上で両方再生成、 が正解。
- ただし user 判断 「文章書き換えが大変」 で放置優先。 少なくとも app/web で snapshot 整合させる。

### F11. `web/messages/{ja,en}.json` に `whyBlockchain` / `legalBasis` 残存

- AUDIT §3 で pruning 対象と挙げているが、 サブセクション網羅に不足。 現状 en.json だけで 3 hits。
- 削除対象キー: `pages.whyBlockchain.*`、 `pages.legalBasis.*`、 `pages.technology.*`、 `pages.why.*`、
  `pages.developers.*`、 `pages.about.*`、 `pages.home.closingCtaWhy`、 `pages.home.whyBlockchainLink`、
  `lp.c2pa.*`、 `lp.gap.*`、 `lp.tp.*`、 `lp.comparison.*`、 `lp.openSource.*`、
  `content.*`、 `field.*`、 `diagram.c2paTitle`、 `diagram.tpTitle`、 `diagram.step1-4`。
- 実務: PR 2 適用後に next-intl を空 messages で走らせて、 型/実行時エラーが出るキーだけ残す方式が最速。

### F12. Cargo.lock ファイル 3 本

- Root `Cargo.lock` (154 KB、 6100 行) — AUDIT §7 PR 4 で root `Cargo.toml` 削除に触れているが、
  `Cargo.lock` を挙げていない。 一緒に消す。
- `native/c2pa-bridge/Cargo.lock` (3270 行) — C2PA crate と一緒に。
- `tools/mock-device/Cargo.lock` (8997 行) — mock-device と一緒に。

### F13. `web/drizzle/meta/0000_snapshot.json` — 死カラム 26 件参照

- `root_asset_id`、 `signed_json_uri` 等が snapshot に生き残り。 AUDIT §3 で「harmless」 と評価された
  が、 実際は stale metadata。 手動編集は面倒なので `drizzle-kit generate` で再生成、
  または snapshot 使わない (SQL 直流し) 方針なら snapshot ごと削除。

### F14. `programs/license-nft/README.md` と `tests/license-nft/README.md`

- ディレクトリ削除と同時に消える。 単に挙げ漏れの補足。

### F15. `app/src/dataflow/steps/sign.ts` の transitive break points

- AUDIT §3 「App-side edits」 は `sign.ts` 削除に触れているが、 削除しただけで壊れる import 元を
  明示していない:
  - `app/src/dataflow/pipeline.ts:19` — `signRecording` を import
  - `app/src/dataflow/steps/index.ts:11` — `sign*` を re-export
- PR 9 でこれらを同時に scrub する必要あり。

## 4. コンポーネント別追加調査

### Root 直下の再列挙 (user 明示指摘)

**Tracked** (12 files):
| Path | Action | Note |
|---|---|---|
| `.gitignore` | 編集 | AUDIT §3 参照 |
| `Anchor.toml` | 削除 | 28 lines |
| `Cargo.toml` | 削除 | 23 lines |
| `Cargo.lock` | 削除 | 154 KB、 6100 行 (**F12**) |
| `CLAUDE.md` | 全面書き換え | AUDIT §3 |
| `LICENSE` | keep | |
| `README.md` | 全面書き換え | AUDIT §3 |
| `check_clip.py` | 削除 | 12050 B |
| `relabel.py` | 削除 | 3066 B |
| `run_p2.py` | 削除 | 2590 B |
| `run_p3.py` | 削除 | 2170 B |
| `run_p3.sh` | 削除 | 1613 B |

**Untracked (disk only)**:
- `.DS_Store` (10 KB、 ローカル rm)
- `.wrangler/` (Cloudflare local dev、 ローカル rm 可)
- `network.json` (488 B、 gitignored、 ローカル rm)
- `progress/` (~700 MB、 pitch archive、 user private → 触らない)
- `sample/` (dataset scratch、 gitignored → 触らない)
- `rootlens-sample-5h-2026-06-20.zip` (**28 GB**、 user 手動)
- `.claude/`、 `keys/`、 `references/` (user rule で保持)

### `programs/license-nft/` 12 files
946 lines Rust。 削除。 (詳細は再監査結果 §D 参照。 サイズ・行数記録済)

### `crates/cli/` 11 files
1161 lines Rust。 削除。

### `tests/license-nft/` 21 tracked files
audit spec 4 + 各種 setup + helpers + issue-license 系。 `fixtures*.json` は untracked (gitignored)。

### `tests/staking/` 9 tracked files
staking + issue-license E2E。 `03-api-license-issue.spec.ts` は task 02 で消えた endpoint を参照。

## 5. 更新した PR 順序 (前回 10 PR → 12 PR)

前回 AUDIT.md §7 の順序をベースに、 F1 / F2 / F5 / F6 / F7 分の PR を追加。

| # | PR | 内容 | 差分 |
|---|---|---|---|
| 1 | docs 更新 | README/CLAUDE/llms/robots + 空 spec 充填 | AUDIT §7 と同じ |
| 2 | dead LP surfaces 削除 | verify tree + LP verify components + LP pages + web deps 11 個 | 追加: `web/vercel.json` の crons 削除 (**F9**) |
| 3 | WDK workflow 削除 | `web/app/.well-known/workflow/v1/` + `withWorkflow` + `workflow` dep | AUDIT §7 と同じ |
| 4 | Anchor + license-cli + tests 削除 | programs/ + crates/ + tests/ + Anchor.toml + Cargo.toml | 追加: root `Cargo.lock` (**F12**) |
| 5 | mock-device + smoke + scratch 削除 | tools/mock-device/ + tools/smoke-test.sh + tools/gen-dummy-sensors.py + tools/macos-blur/ + root scratch 5 本 | 追加: `tools/mock-device/Cargo.lock` (**F12**) |
| 6 | CLAUDE.md 最終形 | 現状反映の全面書き換え | AUDIT §7 と同じ |
| **6.5** | **native/jarosz-wasm/ 削除** | **F1**: 孤児クレート + `.gitignore` に `**/target/` 追加 | **新規** |
| 7 | app 依存整理 | `@title-protocol/sdk`、 `viem` 撤去 + `react-native-passkeys`/`react-native-qrcode-*` grep 検証 | AUDIT §7 の拡張 |
| 8 | DB migration + 全 rename (breaking) | signature_hash→content_hash 系 | AUDIT §7 と同じ |
| **8.5** | **孤児 sensors/units 削除** | **F2/F3/F4/F7**: `app/src/sensors/` + `app/src/native/sensorSession.ts` + `app/modules/sensor-session/` + `app/src/units/privacy-blur/index.ts` | **新規** |
| 9 | C2PA D1 + privacy-blur + AesGcm 削除 | AUDIT §7 PR 9 の拡張。 追加削除: `AesGcm{Module,Package}.kt`、 iOS `AesGcmModule.swift/.m`、 `MainApplication.kt:29` の該当 add() 撤去、 `native/c2pa-bridge/Cargo.lock` (**F5/F6/F12**) | 拡張 |
| 10 | Modal pipeline 再編 | `tools/modal/` を score-wilor/ + fpvlabs/ に分離 + gtsam_eval.py 削除 | AUDIT §7 と同じ |

## 6. Post-PR grep 検証コマンド (差分追加分)

AUDIT.md §7 は grep コマンド未提供。 各 PR 適用後に走らせて残骸ゼロを確認する:

```
EXCL='--exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=target --exclude-dir=references --exclude-dir=keys --exclude-dir=progress --exclude-dir=sample --exclude-dir=.build --exclude-dir=Pods --exclude-dir=.wrangler --exclude-dir=v0.1.0 --exclude-dir=v0.1.1 --exclude-dir=v0.1.2 --exclude-dir=v0.1.3'
```

**PR 4 後 (Anchor)**:
```
find . -maxdepth 3 -name 'Cargo.toml' -not -path './native/c2pa-bridge/*' -not -path './tools/mock-device/*'
grep -rn 'anchor_lang\|#\[program\]\|Bubblegum\|license_nft' . $EXCL
```
期待: 前者は空、 後者は v0.1.3 履歴 doc のみ。

**PR 5 後 (mock/scratch)**:
```
find . -maxdepth 1 -name 'run_p*' -o -name 'relabel.py' -o -name 'check_clip.py'
find tools -type d -name 'mock-device' -o -name 'macos-blur'
```

**PR 6.5 後 (jarosz)**:
```
find native -type d -name 'jarosz-wasm'
grep -rn 'jarosz' . $EXCL
```

**PR 8 後 (identity migration)**:
```
grep -rnE 'signature_hash|signatureHash|wallet_pubkey|walletPubkey|X-Wallet-Pubkey|rootAssetId|root_asset_id|signed_json|signedJsonUri|json_uri|tos_consents|tosConsents' . $EXCL
```
期待: task 12 README + migration SQL のみ hit。

**PR 8.5 後 (orphan sensors)**:
```
find app/src/sensors app/src/units -type d
grep -rn "from '.*sensors\|from '.*units/privacy-blur" app/src $EXCL
```

**PR 9 後 (C2PA + AesGcm)**:
```
grep -rniE 'c2pa|jumbf|AesGcm|CallbackSigner|active_manifest' . $EXCL
find app/modules -type d -name 'c2pa-bridge' -o -name 'privacy-blur'
find native -type d -name 'c2pa-bridge'
find app/android -name 'libc2pa*' -o -name 'c2pa_jni*' -o -name 'C2paBridge*' -o -name 'AesGcm*'
find app/ios -name 'AesGcmModule*'
```

**PR 10 後 (Modal 再編)**:
```
find tools/modal -maxdepth 1 -name '*.py'  # トップに loose .py があってはならない
```

**マスターチェック**:
```
git ls-files | wc -l   # 667 → cleanup 後 ~500 想定
find . -name '.DS_Store' -not -path './.git/*' -not -path '*/node_modules/*' -not -path '*/.next/*' -not -path './references/*'
```

## 7. まだ曖昧な項目 (実装前に user 判断)

1. **F4 `app/modules/sensor-session/` を今削除するか、 v0.1.5 の IMU capture 用に残すか**。
   Android 側は既に `MainApplication.kt` に非登録 (inert)、 iOS 側は Podfile.lock で
   pod link 残存。 消せば軽くなるが、 IMU 系を後で復活させる想定がある場合は要保持。 推奨は削除
   (git 履歴からの復活は容易)。
2. **`web/scripts/r2_inspect.mjs`** — grep 上 caller ゼロ。 AUDIT §9 は「汎用 R2 utility として keep」。
   実際に使ってなければ削除でよい。
3. **`react-native-passkeys` / `react-native-qrcode-*` / `@likashefqet/react-native-image-zoom`**
   — 実 grep で使用箇所要確認。 Privy 経路 (passkeys) と QR / zoom はそれぞれ独立。
4. **`app/src/content/legalDocs.generated.ts` と `web/content/legalDocs.generated.ts` の再生成**
   — 内容不整合 (**F10**)。 少なくとも両者 sync すべきだが、 元 md (`document/v0.1.3/legal/*.md`)
   に NFT 記述が残っているので、 md 側の書き換え → 再生成、 が本来。 user 判断
   「文章書き換えが大変」 なら snapshot だけ sync で妥協。

## 8. 実装粒度のメモ

- PR 6.5 と 8.5 は「後付けで思い出した孤児削除」 なので、 それぞれ単独で 5-10 file 級の小さい PR。
  順序を守る必要はほぼないが、 番号は既存に沿って 6.5 / 8.5 に置く。
- PR 9 は複数プラットフォーム (Rust + iOS Swift/ObjC + Android Kotlin/JNI + web + JS wrapper) の
  同時削除で最も広い。 分割の目安: (a) `native/` + `web/` server-side、 (b) `app/modules/*` +
  `app/ios/*` + `app/android/*`、 (c) `app/src/` の import 切断。 3 段で分けても正。
- PR 8 (identity migration) は breaking なので単独 PR で必ずリリース。
- Modal 再編 (PR 10) は Modal 側の deploy path が変わるので、 `RUNBOOK.md` と
  `list_pending.py` の path 参照を同一 PR 内で更新すること。
