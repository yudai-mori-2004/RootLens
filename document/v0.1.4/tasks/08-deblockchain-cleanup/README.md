# 08. ブロックチェーン残骸の全撤去 (= ゼロベース化)

## 目的

v0.1.4 の実像 (= カメラ計測 + C2PA 署名 + 手動アップロード) に対して、 ブロックチェーン時代の
残骸 (wallet / Solana / mint / staking / license / buyer) をコードベースから消し、
「今の仕様をゼロベースで組んだような」 状態にする。 履歴は git にあるので物理削除で良い。

## 設計判断 (= 2026-07-04 確定)

### 1. 識別子は「アカウント公開鍵」 に改名 (= 実体は Ed25519 のまま)

- 端末は Ed25519 鍵 (SecureStore、 旧 debug wallet と同じ 64 byte base58 形式 = **既存端末の鍵を
  そのまま引き継ぐ**) を持ち、 その公開鍵 base58 がクリップ所有者の識別子。
- `AuthSession.pubkey` は `PublicKey` (web3.js) → `string` (base58) に。 @solana/web3.js 依存を
  auth から排除し、 @noble/curves の ed25519 で生成・検証する。
- HTTP header は `X-Wallet-Pubkey` → **`X-Account-Pubkey`** (server は旧 header も読む後方互換)。
- AuthProvider から signTransaction / signMessage を削除 (= 未使用。 復活は git から)。

### 2. `network` (devnet/mainnet) を API 契約から撤去

- app は network を送らない。 zod からも撤去 (= 未知キーは strip)。
- 重複排除キーは (account, signature_hash) に縮小。
- DB の `network` 列 + `wallet_pubkey` 列名はこのタスクでは触らない (= 仕様書ゼロベース練り直しの
  際に、 users テーブル等と一緒に 0002 migration で改名/削除するのが良い。 server 内部のみの残骸)。

### 3. 削除したもの (app)

- BuyerScreen / debug/buyerWallet / domain/licenseCatalog (= 購入シミュレータ一式)
- services/nativeCryptoProvider (未使用)
- env: SOLANA_RPC_URL / SOLANA_NETWORK / TP_GATEWAY / COSIGN_AUTHORITY / MERKLE_* / BUYER_*
  (残り 3 つ: USE_SANDBOX / SERVER_URL / DEBUG_ACCOUNT_BASE58。 debug 鍵の env は
  `EXPO_PUBLIC_DEBUG_WALLET_BASE58` → `EXPO_PUBLIC_DEBUG_ACCOUNT_BASE58` に改名)
- config: 旧 endpoint 群 (upload-url / publish / vlm-gate / license)。 残り = serverUrl +
  device-certificate 系 (= C2PA 用、 現役)
- deps: @solana/web3.js / @privy-io/expo / @privy-io/expo-native-extensions /
  @ethersproject/shims / @noble/ciphers。 shim.ts は getRandomValues + Buffer のみに縮小
- i18n: 未使用 85 キー (stake.* / detail.* / home.* / portfolio hero 系 / clip の販売系) を機械削除

### 4. 文言の現実合わせ (= 平易語、 ブロックチェーン語彙ゼロ)

- 設定: 「ウォレット」→「アカウント ID」 (solscan リンク削除)、 KYC 行 / BGM 行 / CLUSTER /
  SOLANA RPC / COSIGN / TP PROXY 行を削除。 DEVELOPER は SERVER + ACCOUNT のみ
- ログイン: lede から「Root NFT / Solana / 顔ぼかし」 を削除 → 「端末の署名つきで保存され、
  あなたが確認してからアップロード」。 provider 説明も Privy 言及を削除
- **オンボーディング slide2 を書き換え** (= 重要): 旧「顔は自動でぼかします」 は v0.1.4 では
  事実と異なる (= blur しない生映像を上げる)。 新「送る前に、 自分で確認。」 (= 手動アップロード
  + プレビュー確認の実フローに一致、 法務スタンス「同意ベース」 とも整合)

### 5. web 側で残した現役 API

`clips` / `raw-uploads` / `device-certificate` + `crl` (= C2PA PKI) / `delete-account` (= App Store 要件)。

### 6. web の死んだ v1 route は削除、 LP ページは温存 (= ユーザー判断)

- 削除: governance / indexer / license / pages / publish / upload-url / users / vlm-gate /
  webhooks の 9 route + 専用 lib (license-nft / server/cnft-indexer / tp-gateway) +
  test/license-nft + scripts/backfill.ts。
- 温存: 公開 LP ページ ([addressOrUsername] / p/[shortId] / why-blockchain / sample / legal) と
  その依存 lib (data / server/page-store / verify)。 LP の扱いは仕様書練り直しの時に再判断。
- 残現役 API: clips / raw-uploads / device-certificate / crl / delete-account。

### 7. デバイス証明書サブシステムも削除 (= 2026-07-04 追加判断)

調査の結果、 **プロビジョニングされたデバイス証明書は C2PA 署名に使われていなかった**:
`signD1` は Rust FFI `pipeline1_sign_d1(input, output)` を鍵引数なしで呼び、 署名鍵は
crate に焼き込まれた固定証明書 (`native/c2pa-bridge/fixtures/chain.pem` + `ee.key`、
= "Title Protocol Test EE")。 Rust コメントいわく「production は Secure Enclave callback
signer に (予定)」 のまま未実装。 つまり CertGate (TEE 鍵 → App Attest → CSR → サーバ CA
→ CRL) は署名経路につながっていない並行配管で、 初回起動をサーバ依存でブロックする
コストだけ払っていた。 削除しても署名は 1 bit も変わらない。

- 削除 (app): App.tsx の CertGate (= 起動が速くなり圏外でも起動可)、
  useCertificateProvisioning、 c2paBridge の証明書系 wrapper 6 本 + DeviceCredentials 型、
  config の device-certificate URL、 i18n app.* キー
- 削除 (web): device-certificate / crl route、 lib/server の ca / attestation-ios /
  attestation-android / cert-store / crl / crypto / crypto-kms / vlm-gate / rate-limit
  (= 全部この経路の専用品) + tests
- 削除: certs/ (dev PKI 生成一式。 Rust テスト用の app/dev-certs/ PEM は残置)
- **native (Swift/Rust) は触らない**: 未使用関数が残るだけで無害。 次に native を触る時に掃除
- 将来ハードウェア実証つき来歴が要る時は、 Secure Enclave callback signer 設計で正しく再導入
  (= 証明書を配って UserDefaults に置くのではなく、 TEE 鍵で直接 COSE 署名する)

### 8. 未処理 (= 仕様書ゼロベース練り直しの時に)

- DB 列 (wallet_pubkey / network) の改名・削除 migration。
- LP の why-blockchain / プロフィール / 共有ページの扱い。
- native (Swift/Rust) の未使用 TEE / 証明書関数の掃除 + 署名鍵の正式設計
  (= 今は焼き込みテスト証明書。 実運用の来歴信頼性はここで決まる)。

## 成功基準

- app/src に blockchain 語彙 (solana / wallet / mint / stake / devnet / ...) が legal 生成物以外
  ゼロ (実測済)。
- tsc (app/web) + dataflow purity green (実測済)。
- 既存端末の鍵・AsyncStorage クリップがそのまま引き継がれる (= SecureStore キー名と 64 byte
  形式を維持)。

## 進捗

- [x] 上記 1-5 全部 (2026-07-04)
- [ ] 実機確認 (= 旧鍵の引き継ぎ + サインイン + アップロード一連)
- [ ] web 死に route + LP の扱い (= ユーザー判断待ち)
