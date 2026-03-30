# Task 22: pHash → PDQ マイグレーション + cert-rootlens 対応

## 目的

Title Protocol の WASM モジュール刷新（image-pdq, video-vpdq, cert-rootlens）に合わせて、
RootLens の公開ページ検証・アプリ公開パイプライン・仕様書を更新する。

## 背景

TP側で以下が完了:
- `image-pdq`: Meta ThreatExchange互換 256bit PDQ（旧 image-phash 64bit DCT を置換）
- `video-vpdq`: フレーム単位PDQ（旧 video-phash を置換）
- `cert-rootlens`: RootLens Root CA に対する厳密なX.509証明書チェーン検証
- `cert-google`, `cert-sony`, `cert-leica`: 同アーキテクチャ

## 実施内容

### 1. Jarosz WASM ビルド

TP の `wasm-host/src/jarosz.rs` をコピーし、`wasm32-unknown-unknown` でビルド。
ブラウザでTPと同一アルゴリズムのダウンサンプリングを実行するため。

- `native/jarosz-wasm/` クレート作成
- `src/lib.rs`: jarosz.rs から `downsample_from_decoded` をエクスポート
- ビルド: `cargo build --target wasm32-unknown-unknown --release`
- 出力: `web/public/wasm/jarosz.wasm`

### 2. PDQ ブラウザ検証 (`web/lib/verify/pdq-wasm.ts`)

旧 `phash-wasm.ts` を置き換え:

```
Canvas → RGBAピクセル
  ↓
jarosz.wasm (RootLensビルド、TPと同一アルゴリズム)
  ↓ 64x64 グレースケール
  ↓
image-pdq.wasm (GlobalConfigから動的取得、SHA-256照合済み)
  ↓ ホスト関数ブリッジ: get_decoded_feature → jarosz出力を返す
  ↓
256bit PDQハッシュ → オンチェーンPDQとハミング距離比較
```

### 3. アプリ公開パイプライン

`titleProtocol.ts` の `processor_ids`:
```
旧: ['core-c2pa', 'image-phash']
新: ['core-c2pa', 'image-pdq', 'cert-rootlens']
```
動画の場合: `video-vpdq` を追加

### 4. 公開ページ Extension ID 更新

`verify-content.ts`:
- `image-phash` → `image-pdq` の判定分岐
- `cert-rootlens` / `cert-google` 等の検証結果表示
- ハミング距離の閾値変更（64bit空間 → 256bit空間）

### 5. ガバナンスAPI更新

`governance/[network]/route.ts`:
- `phash_extensions` → `pdq_extensions`
- `cert-rootlens` を `trusted_extensions` に追加

### 6. コンソールログ・UI更新

- 「pHash」→「PDQ」用語変更
- 256bit ハッシュ値の表示（64hex文字）
- cert-rootlens 検証結果の表示
- i18n キーの更新

### 7. 仕様書更新

- §6.3: pHash → PDQ に全面書き換え
- §7.4: ブラウザ検証フローの更新
- COVERAGE.md 更新

### 8. WASM 管理 README

`web/public/wasm/README.md` — 対応バージョン、更新日、動作確認状況を記載

## 保守対象（最小限）

TP更新時にRootLens側で追従が必要なもの:

1. **jarosz.wasm**: `jarosz.rs` をTPからコピーして再ビルド（ビルドスクリプト）
2. **ホスト関数ブリッジJS**: `decode_content`, `get_decoded_feature` 等の~30行

自動追従:
- `image-pdq.wasm`, `cert-rootlens.wasm` → GlobalConfigから動的取得、変更不要

## 完了条件

- [ ] `native/jarosz-wasm/` クレート作成、WASMビルド成功
- [ ] `web/lib/verify/pdq-wasm.ts` が image-pdq.wasm + jarosz.wasm で256bit PDQを計算
- [ ] アプリの processor_ids が `image-pdq`, `cert-rootlens` を含む
- [ ] 公開ページで PDQ ハミング距離が正しく表示される
- [ ] cert-rootlens 検証結果が表示される
- [ ] ガバナンスAPIが更新されている
- [ ] コンソールログ・i18n が PDQ 用語に更新
- [ ] `web/public/wasm/README.md` が管理情報を記載
- [ ] 仕様書が PDQ に更新されている
- [ ] TypeScript ビルド成功
