# RootLens 信頼モデル — 公開ページ説明文のためのリファレンス

コードベースの実装から読み解いた信頼構造の全体像。
公開ページのUI説明文をブラッシュアップする際のストーリー原案として使用する。

---

## 0. このドキュメントの目的

現在の公開ページの説明は「検証結果の共有」（ブラウザ内のトラストレス検証）に偏っている。
しかしRootLensの信頼モデルは、それよりも広い構造を持つ:

1. **コンテンツが生まれるときの信頼** — 撮影・署名（デバイス側）
2. **コンテンツが検証・記録されるときの信頼** — Title Protocol TEE + Solana
3. **コンテンツが閲覧されるときの信頼** — ブラウザ内トラストレス検証

これら3つのフェーズが、どのコンテンツ出自（RootLens / Google Pixel / Sony / Leica）でも
同じ構造で並列に語られる必要がある。

---

## 1. 全体構造: 3つの信頼フェーズ

```
╔══════════════════════════════════════════════════════════════════╗
║                    Phase 1: コンテンツの誕生                     ║
║                    「誰が、何で撮ったか」                        ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║   ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐   ║
║   │ ハードウェア署名  │  │ ハードウェア署名  │  │ アプリ署名    │   ║
║   │                  │  │                  │  │              │   ║
║   │ Google Pixel     │  │ Sony / Leica     │  │ RootLens     │   ║
║   │ (Titan M2)       │  │ (セキュアチップ)  │  │ (TEE + PKI)  │   ║
║   │                  │  │                  │  │              │   ║
║   │ センサー直結署名  │  │ センサー直結署名  │  │ OS経由署名    │   ║
║   └────────┬─────────┘  └────────┬─────────┘  └──────┬───────┘   ║
║            │                     │                    │           ║
║            └──────── すべてC2PA署名付きコンテンツ ─────┘           ║
║                              │                                    ║
╠══════════════════════════════╪════════════════════════════════════╣
║                              ▼                                    ║
║                    Phase 2: 検証と記録                            ║
║                    「第三者が暗号的に検証し、結果を不変に記録」    ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║   ┌──────────────────────────────────────────────────────────┐   ║
║   │  Title Protocol TEE ノード                               │   ║
║   │                                                          │   ║
║   │  1. C2PAのID抽出（RootLensでは来歴に意味づけはしない） ─────────→ Core cNFT              │   ║
║   │  2. C2PAの証明書チェーン検証 ─────────→ cert-* Extension cNFT   │   ║
║   │     (Root CA SPKIに対して)                                │   ║
║   │  3. 知覚ハッシュ(PDQ/vPDQ)計算 →  PDQ/vPDQ Extension cNFT  │   ║
║   │                                                          │   ║
║   │  全結果に署名を付与　 →　 signed_json                    │   ║
║   └──────────────────────────┬───────────────────────────────┘   ║
║                              │                                    ║
║                     Solana ブロックチェーン                       ║
║                     cNFTに紐づけて                            ║
║                              │                                    ║
╠══════════════════════════════╪════════════════════════════════════╣
║                              ▼                                    ║
║                    Phase 3: 閲覧と再検証                          ║
║                    「誰でも、RootLensを信頼せずに確認できる」      ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║   ┌──────────────────────────────────────────────────────────┐   ║
║   │  閲覧者のブラウザ                                        │   ║
║   │                                                          │   ║
║   │  Solana RPC → cNFT取得 → signed_json取得                 │   ║
║   │  → TEE署名の検証 = signed_jsonがTEEで計算された内容のまま改ざんなし │   ║
║   │  → コレクション所属確認 = 計算結果自体が信頼できるかどうか（万が一TEEサイドチャネル攻撃等の不正で計算結果がハックされていたことに気づいた時も、Authorityがコレクションから外すことで事後的に除外できる）                                  │   ║
║   │  → PDQ再計算 & ハミング距離照合 = 登録されたコンテンツと見た目・知覚の観点で一致する                           │   ║
║   │  → cert検証 & 信頼CAの照合 = C2PA署名の証明書チェーンの発行元がRootLensが信頼しているCAリストに含まれる = RootLensにおいては、いわゆるカメラで撮影されたコンテンツであることの証明となりうるCAであることを確かめる │   ║
║   │  RootLensサーバーは一切関与しない                          │   ║
║   └──────────────────────────────────────────────────────────┘   ║
╚══════════════════════════════════════════════════════════════════╝
```

---

## 2. Phase 1: コンテンツの誕生 — 2つの信頼レベル

### 2.1 ハードウェアレベル署名（Google Pixel, Sony, Leica 等）

```
センサー ──→ セキュアチップ ──→ C2PA署名
              (Titan M2 等)
              秘密鍵はチップ外に出ない
              OSの介入が原理的に不可能
```

**信頼の根拠**: 端末メーカーが工場出荷時にセキュアチップへ鍵をバインドし、
自社Root CAでデバイス証明書に署名している。
センサーからの信号を直接暗号化するため、仮想カメラやスクリーンキャプチャの注入を
**原理的に**排除できる。

**証明の範囲**: 「このコンテンツは、このハードウェアのセンサーで取得された
未改ざんのデータである」

**PKI構造** (メーカーによる):
```
メーカー Root CA
  └── デバイス証明書（工場出荷時にバインド）
```

**コード上の対応**:
- `useC2paCache.ts`: C2PAマニフェストの`signer_org`フィールドでメーカーを識別
- `TRUSTED_SIGNER_PATTERNS`: `['RootLens', 'Google', 'Sony', 'Leica']`
- ギャラリーでは信頼できるC2PA署名を持つコンテンツだけが選択可能になる

### 2.2 アプリレベル署名（RootLens）

```
カメラAPI(OS) ──→ TEE (Secure Enclave / StrongBox) ──→ C2PA署名
                   秘密鍵はTEE外に出ない
                   ただしセンサー→TEE間はOSを経由する
```

**信頼の根拠**: ハードウェアメーカーのセンサー直結署名とは異なるアプローチ。
以下の3つの検証を組み合わせて信頼を構築する:

1. **Platform Attestation** — デバイスのハードウェア真正性
   - Android: Key Attestation（鍵がTEE内で生成された証明） + Play Integrity
   - iOS: App Attest（`clientDataHash = SHA-256(CSR)` で鍵とCSRを紐づけ）

2. **TEE鍵保護** — 秘密鍵がチップ外に出ないことの保証
   - iOS: Secure Enclave (EC P-256)
   - Android: StrongBox / TEE-backed KeyStore (EC P-256)

3. **RootLens PKI** — 3層証明書チェーンによるデバイス認証
   ```
   RootLens Root CA (AWS KMS, 20年)
     └── iOS/Android Intermediate CA (AWS KMS, プラットフォーム別)
           └── Device Certificate (90日, TEE公開鍵に紐づき)
   ```

**証明の範囲**: 「正規のRootLensアプリが、改ざんされていない端末のTEE内で署名した」

**ハードウェア署名との違い**:
カメラセンサーからTEEまでの経路がOSを経由する。
理論上、OSレベルの攻撃（仮想カメラ注入等）を完全には排除できない。
ただしPlatform Attestation（Key Attestation / App Attest）により、
root化された端末やデバッグビルドからの署名は拒否される。

**この限界は意図的なトレードオフ** (仕様書 §4.1.2):
C2PA対応ハードウェアの普及がまだ限定的なため、
アプリレベルの署名でエコシステムのコールドスタート問題を解決する。
ハードウェア署名付きコンテンツはRootLens上でも引き続き公開できるため、
ハードウェアの普及後もプラットフォームの価値は維持される。

### 2.3 編集と来歴グラフ

どちらの出自でも、編集が加わると来歴グラフ（provenance graph）が形成される:

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  パターン1: ハードウェア撮影 → 編集なし → 公開        │
│  C2PA: [ハードウェア署名のみ]                        │
│  表示: 「Shot on Google Pixel」                      │
│                                                      │
│  パターン2: ハードウェア撮影 → RootLensで編集 → 公開  │
│  C2PA: [ハードウェア署名] → [RootLens署名(edited)]   │
│          ingredient           active manifest        │
│  表示: 「Shot on Google Pixel, Edited on RootLens」  │
│                                                      │
│  パターン3: RootLens撮影 → 編集なし → 公開           │
│  C2PA: [RootLens署名のみ]                            │
│  表示: 「Shot on RootLens」                          │
│                                                      │
│  パターン4: RootLens撮影 → RootLensで編集 → 公開     │
│  C2PA: [RootLens署名(captured)] → [RootLens署名(edited)] │
│  表示: 「Shot on RootLens」（編集履歴付き）           │
│                                                      │
└──────────────────────────────────────────────────────┘
```

`signContentWithParent()` (c2paBridge.ts) は元画像のC2PAマニフェストを
「ingredient（素材）」として取り込み、`c2pa.edited` アクションで再署名する。
これにより来歴の連鎖が暗号的に辿れるようになる。

---

## 3. Phase 2: 検証と記録 — Title Protocol TEE

Phase 1で生まれたC2PA署名付きコンテンツは、出自に関わらず
同一のパイプラインで検証・記録される。

### 3.1 暗号化通信チャネル

```
アプリ                              TEEノード
──────                              ────────

X25519 ECDH鍵共有
  ├── TEEノードの公開鍵
  │   (GlobalConfigからオンチェーン取得)
  ├── エフェメラル秘密鍵（使い捨て）
  └── 共有秘密 → HKDF-SHA256
        ├── request_key（アプリ→TEE方向）
        └── response_key（TEE→アプリ方向）

AES-256-GCM でコンテンツを暗号化
（ネイティブモジュールで実行、大容量データがJS Bridgeを通らない）
```

### 3.2 TEEノード内での検証

TEEノードは暗号化されたコンテンツを受け取り、内部で以下を実行:

```
┌─────────────────────────────────────────────────────────────┐
│  Title Protocol TEE ノード                                   │
│                                                              │
│  入力: C2PA署名付きコンテンツ + processor_ids                │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐   │
│  │ core-c2pa プロセッサ                                   │   │
│  │   C2PAマニフェストを解析                                │   │
│  │   → 来歴グラフ（nodes + links）を抽出                  │   │
│  │   → content_hash を計算                                │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐   │
│  │ cert-* プロセッサ (コンテンツ出自に応じて選択)          │   │
│  │   cert-rootlens: RootLens Root CA の SPKI に対して検証  │   │
│  │   cert-google:   Google の Root CA の SPKI に対して検証  │   │
│  │   cert-sony:     Sony の Root CA の SPKI に対して検証    │   │
│  │   cert-leica:    Leica の Root CA の SPKI に対して検証   │   │
│  │                                                        │   │
│  │   WASMバイナリ内にRoot CA SPKIがハードコード             │   │
│  │   → WASMのハッシュがGlobalConfigにオンチェーン登録       │   │
│  │   → WASMの改ざん検出が可能                              │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐   │
│  │ image-pdq / video-vpdq プロセッサ                      │   │
│  │   画像: 256bit PDQ ハッシュを計算                       │   │
│  │     RGBA → BT.601 grayscale → Jarosz downsample        │   │
│  │     → 64×64 → 2D DCT → 16×16低周波 → Torben median    │   │
│  │     → 256bit量子化                                      │   │
│  │   動画: キーフレーム別PDQ (quality ≥ 50のみ)            │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  全結果を それぞれsigned_json としてまとめ、                          │
│  TEEの Ed25519 秘密鍵で署名                                  │
│  (domain tag: "title-protocol-v1")                           │
└──────────────────────────────────┬──────────────────────────┘
                                   │
                                   ▼
                          3つのSolana cNFT をミント
```

### 3.3 processor_ids の選択ロジック

アプリ側でC2PAマニフェストの `signer_org` を読み取り、
適切なプロセッサの組み合わせを決定する (titleProtocol.ts):

```
signer_org = "Google"  →  ['core-c2pa', 'cert-google',   'image-pdq']
signer_org = "Sony"    →  ['core-c2pa', 'cert-sony',     'image-pdq']
signer_org = "Leica"   →  ['core-c2pa', 'cert-leica',    'image-pdq']
signer_org = "RootLens"→  ['core-c2pa', 'cert-rootlens', 'image-pdq']
動画の場合             →  image-pdq の代わりに video-vpdq
```

**重要**: cert-* プロセッサが検証するのは「C2PAの証明書チェーンが、
対応するメーカーのRoot CAまで正しく繋がっているか」であり、
RootLensの証明書チェーンではない。
Google Pixelの写真には cert-google が適用され、
GoogleのRoot CA SPKIに対して証明書チェーンが検証される。

### 3.4 cNFTの構造

```
1コンテンツ = 1 Core cNFT + N Extension cNFTs
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌────────────────────────────────────────────────────────┐
│  Core cNFT (core-c2pa)                                 │
│  コレクション: GlobalConfig.core_collection_mint       │
│                                                        │
│  signed_json.payload:                                  │
│    content_hash  — コンテンツの暗号ハッシュ             │
│    nodes[]       — C2PA来歴グラフのノード               │
│    links[]       — ノード間の関係                       │
│    tsa_timestamp — RFC 3161 タイムスタンプ (あれば)     │
│                                                        │
│  cNFT attributes:                                      │
│    content_hash, device_name, captured_at,              │
│    assurance_level, content_type, ...                   │
│                                                        │
│  signed_json:                                          │
│    tee_pubkey    — TEEノードの Ed25519 公開鍵           │
│    tee_signature — JCS({payload, attributes}) の署名   │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│  Extension cNFT (cert-*)                               │
│  コレクション: GlobalConfig.ext_collection_mint        │
│                                                        │
│  signed_json.payload:                                  │
│    extension_id  — "cert-google" / "cert-rootlens" 等  │
│    wasm_hash     — TEEが実行したWASMのSHA-256           │
│    verified      — 証明書チェーン検証結果 (bool)        │
│    root_ca       — 検証に使ったRoot CA名                │
│                                                        │
│  意味: 「C2PA証明書チェーンが、対応するメーカーの       │
│        Root CA SPKIに対して正しいことが、               │
│        TEE内の検証済みWASMによって確認された」          │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│  Extension cNFT (image-pdq / video-vpdq)               │
│  コレクション: GlobalConfig.ext_collection_mint        │
│                                                        │
│  signed_json.payload:                                  │
│    extension_id  — "image-pdq" / "video-vpdq"          │
│    wasm_hash     — TEEが実行したWASMのSHA-256           │
│    pdqhash       — 256bit PDQハッシュ (画像)            │
│    frames[]      — キーフレーム別PDQ配列 (動画)         │
│                                                        │
│  意味: 「コンテンツの見た目の指紋。閲覧者が            │
│        ブラウザ内で再計算して同一性を確認できる」       │
└────────────────────────────────────────────────────────┘
```

---

## 4. Phase 3: 閲覧と再検証 — トラストレス

### 4.1 データ取得の信頼レイヤー

```
閲覧者のブラウザ
     │
     │  shortId → contentHash (Supabase)
     │  ※ ここだけサーバー経由
     │
     ▼
┌──────────────────────────────────────────────────────┐
│  インデクサ DB (Supabase cnft_assets)                 │
│  contentHash → asset_id 候補リスト                    │
│                                                      │
│  【信頼しない】                                       │
│  ルックアップのみ。結果は必ずDASで再検証される。      │
│  偽のasset_idを返しても次のステップで棄却される。     │
│  できる最悪の攻撃は「正しいcNFTを返さない」(DoS)     │
│  だが、偽の検証成功は作れない。                       │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│  DAS API (Helius) — Solanaのオンチェーンデータの窓口  │
│  getAsset(asset_id) → cNFTの属性・コレクション・URI   │
│                                                      │
│  ここで以下を確認:                                    │
│  ✓ コレクション所属 == GlobalConfig の公式コレクション │
│  ✓ content_hash 属性 == 検索した contentHash          │
│  不一致 → 棄却                                        │
│                                                      │
│  【Solana状態の窓口として信頼】                       │
│  不安なら別のRPCプロバイダに切り替えて再検証可能。    │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│  オフチェーンストレージ — signed_json 取得             │
│  cNFTの json_uri から直接 fetch                       │
│                                                      │
│  【信頼不要 — 自己証明的】                            │
│  TEE署名 (Ed25519) が内容の真正性を保証する。         │
│  保存先が改ざんされても署名検証で検出される。         │
│  保存先がダウンしたら取得不可だが、                   │
│  偽のデータは作れない。                               │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
               ブラウザ内検証エンジン
```

### 4.2 検証チェック一覧

全cNFTに共通の3チェック + プロセッサ固有チェック:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
全cNFT共通 (common.ts)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Collection
   cNFTのコレクション == GlobalConfigに定義された公式コレクション
   GlobalConfigはSolana RPCから毎回取得（ハードコードしない）

2. TEE Signature
   signed_jsonの {payload, attributes} をJCS正規化
   → domain tag "title-protocol-v1" 付加
   → Ed25519 署名検証 (Web Crypto API)
   → TEEノードが生成した署名であることの暗号的証明

3. Content Binding
   payload.content_hash == 検索に使った contentHash
   → signed_jsonが確かにこのコンテンツに対するものであることの確認

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
core-c2pa 固有 (core-c2pa.ts)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

4. Provenance
   C2PA来歴グラフに少なくとも1つのnodeが存在するか
   → 来歴情報が空でないことの確認

5. Originality
   同一content_hashの全Core cNFTのうち最古であるか
   → 重複登録された場合にオリジナルを識別

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
cert-* 固有 (cert.ts)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

6. WASM Trusted
   payload.wasm_hashがGlobalConfigのtrusted_wasm_modulesに登録済みか
   → TEEが実行したWASMバイナリが既知の検証済みバージョンであることの確認
   → WASMにハードコードされたRoot CA SPKIの正当性を間接的に保証

7. Cert Verified
   TEE内のWASMがC2PA証明書チェーンを verified=true と判定したか
   → メーカーRoot CA SPKIに対する証明書チェーンの検証結果

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
image-pdq / video-vpdq 固有 (image-pdq.ts, video-vpdq.ts)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

8. WASM Trusted (同上)

9. PDQ/vPDQ Match
   ブラウザ内で純粋TypeScriptにより画像/動画のPDQハッシュを再計算し、
   オンチェーンの値とのハミング距離 ≤ 31 (256bit空間) を確認
   → 表示されている画像/動画が登録時と同一であることの独立検証
   画像: 全体で1つのPDQ
   動画: キーフレーム別PDQ、80%以上のフレームが閾値以内で verified
```

### 4.3 GlobalConfig — オンチェーンの権威的設定

```
Solana上の GlobalConfig PDA (Title Protocol)
  │
  ├── core_collection_mint  — Core cNFT の公式コレクション
  ├── ext_collection_mint   — Extension cNFT の公式コレクション
  ├── trusted_tee_nodes[]   — 信頼されたTEEノードの公開鍵リスト
  ├── trusted_tsa_keys[]    — 信頼されたTSA鍵
  └── trusted_wasm_modules[]— 信頼されたWASMバイナリのハッシュ
       └── versions[]
            ├── version     — バージョン番号
            └── wasm_hash   — SHA-256ハッシュ

検証時にこの値をオンチェーンから直接取得することで、
RootLensサーバーが偽のコレクションやWASMハッシュを注入できない。
```

---

## 5. 信頼レベルの比較表

| 観点 | ハードウェア署名 | RootLens署名 |
|------|-----------------|-------------|
| **信頼の起点** | メーカーのセキュアチップ | Platform Attestation + RootLens Root CA |
| **センサー直結** | はい — OS介入を原理的に排除 | いいえ — OS経由（Platform Attestationで軽減） |
| **PKI構造** | メーカーRoot CA → デバイス証明書 | Root CA → ICA → Device Certificate (3層) |
| **鍵保護** | セキュアチップ内 | TEE内 (Secure Enclave / StrongBox) |
| **Title Protocol検証** | 同一パイプライン | 同一パイプライン |
| **cert-* Extension** | cert-google / cert-sony 等 | cert-rootlens |
| **cNFT構造** | 同一 | 同一 |
| **ブラウザ検証** | 同一 | 同一 |
| **公開ページ表示** | 「Shot on Google Pixel」等 | 「Shot on RootLens」 |

**重要な点**: Phase 2（TEE検証 + cNFT記録）と Phase 3（ブラウザ検証）は
**コンテンツの出自に関わらず完全に同一**。
違いはPhase 1（コンテンツの誕生）における信頼の根拠のみ。

---

## 6. 各レイヤーの信頼性と攻撃耐性

| レイヤー | 信頼レベル | 根拠 | 侵害時の影響 |
|---|---|---|---|
| デバイスTEE (Phase 1) | ハードウェア信頼 | 秘密鍵がチップ外に出ない | C2PA署名の偽造が可能に。ただしPlatform Attestationの突破も必要 |
| Title Protocol TEE (Phase 2) | ハードウェア信頼 | 検証コードがTEE内で実行 | 偽のsigned_jsonを作れるが、wasm_hashがオンチェーンで公開されており改ざん検出可能 |
| Solana ブロックチェーン | コンセンサス信頼 | 経済的コストによる改ざん抑止 | cNFTの改ざん＝Solana全体の信頼崩壊 |
| GlobalConfig (オンチェーン) | authority署名 | オンチェーンで改ざん不可 | authority鍵の侵害＝プロトコル全体の信頼崩壊 |
| DAS API (Helius) | Solanaの窓口 | オンチェーンデータの読み取り | 偽データを返せるが、別RPCに切り替えれば検証可能 |
| signed_json (オフチェーン) | **信頼不要** | TEE署名で自己証明的 | 改ざん→署名検証で検出。ダウン→取得不可だが偽装不可 |
| インデクサ (Supabase) | **信頼不要** | ルックアップのみ | 偽asset_id→DASで棄却。DoS可能だが偽検証成功は不可能 |
| RootLensサーバー | **検証に不参加** | 検証フロー全体に関与しない | 検証の信頼性に影響なし |

---

## 7. ストーリーとして伝えるべきポイント

### 7.1 Phase 1 に関して（公開ページの説明で不足している部分）

**伝えるべきこと**:
- RootLens署名はコンテンツの一形態に過ぎない
- Google Pixel, Sony, Leica 等のハードウェア署名コンテンツも同列に扱われる
- ハードウェア署名のほうが信頼レベルは高い（センサー直結 vs OS経由）
- RootLensはこの違いを隠さず、署名元を明示する
- 編集が加わった場合、来歴グラフで元の署名が追跡可能

### 7.2 Phase 2 に関して

**伝えるべきこと**:
- コンテンツの出自に関わらず、同一のTEE検証パイプラインを通る
- 証明書チェーンの検証は、各メーカーのRoot CA SPKIに対して行われる
  （RootLensのCAではなく、GoogleならGoogleの、SonyならSonyのCA）
- WASMバイナリのハッシュがオンチェーンに記録され、検証コード自体の改ざんが検出可能
- 知覚ハッシュ（PDQ）はコンテンツの「見た目の指紋」で、閲覧者が独立に再計算できる

### 7.3 Phase 3 に関して（現在の説明が集中している部分）

**伝えるべきこと**:
- ブラウザ内で全検証が完結し、RootLensサーバーは一切関与しない
- インデクサは信頼しない。検索の補助に使うだけで、結果はオンチェーンで再検証される
- 知覚ハッシュの再計算により、表示されている画像が登録時と同一であることを確認
- すべての「信頼」は暗号的に検証可能

### 7.4 全体を通して

**核心メッセージ**:
このシステムは「RootLensを信頼してください」とは言わない。
代わりに「自分で検証してください。必要な情報はすべてオンチェーンにあります」と言う。

信頼の起点（Phase 1）だけはデバイスのハードウェアに依存するが、
それ以降の検証・記録・閲覧のすべてが暗号的に検証可能であり、
RootLensというサービスが消滅しても検証可能性は維持される。

---

## 付録A: RootLens 3層PKI の詳細

```
┌──────────────────────────────────────────────────┐
│  Root CA                                          │
│  保管: AWS KMS (ECC_NIST_P256)                    │
│  有効期間: 20年                                   │
│  pathLenConstraint: 1                             │
│  用途: keyCertSign, cRLSign                       │
│  秘密鍵はKMS外に出ない (FIPS 140-2 Level 2)      │
└──────────────────────┬───────────────────────────┘
                       │ 署名
          ┌────────────┴────────────┐
          ▼                         ▼
┌──────────────────┐     ┌──────────────────┐
│ iOS ICA          │     │ Android ICA      │
│ 保管: AWS KMS    │     │ 保管: AWS KMS    │
│ pathLen: 0       │     │ pathLen: 0       │
│                  │     │                  │
│ プラットフォーム  │     │ プラットフォーム  │
│ 別に暗号的独立   │     │ 別に暗号的独立   │
└────────┬─────────┘     └────────┬─────────┘
         │ 署名                    │ 署名
         ▼                         ▼
┌──────────────────┐     ┌──────────────────┐
│ Device Cert      │     │ Device Cert      │
│ (iOS)            │     │ (Android)        │
│ 有効期間: 90日   │     │ 有効期間: 90日   │
│ CA: FALSE        │     │ CA: FALSE        │
│ digitalSignature │     │ digitalSignature │
│ documentSigning  │     │ documentSigning  │
│                  │     │                  │
│ 公開鍵 =         │     │ 公開鍵 =         │
│ Secure Enclave   │     │ StrongBox/TEE    │
│ が生成したもの   │     │ が生成したもの   │
└──────────────────┘     └──────────────────┘
```

**Device Certificate 発行フロー (§4.4)**:

```
デバイス                              サーバー (/api/v1/device-certificate)
────────                              ──────────────────────────────────

TEEで EC P-256 鍵ペア生成
        │
CSR作成 (秘密鍵で自己署名 = Proof of Possession)
        │
Platform Attestation取得
 iOS:  App Attest (clientDataHash = SHA-256(CSR))
 Android: Key Attestation chain + Play Integrity (nonce=SHA-256(CSR))
        │
        ├──── CSR + Attestation ────→  1. CSR自己署名検証
                                       2. 公開鍵アルゴリズム検証 (EC P-256)
                                       3. Platform Attestation検証
                                          - 鍵がTEE内で生成された証明
                                          - CSR公開鍵 == Attestation公開鍵
                                       4. ICA (KMS) で Device Certificate発行
                                       5. 発行記録をDBに保存 (CRL・監査用)
                                            │
        ◀── Device + ICA + Root Cert ──────┘
        │
TEEに3層証明書チェーンを保存
以降、C2PA署名に使用
14日前に自動更新 (バックグラウンド、非ブロッキング)
```

---

## 付録B: ファイルパス一覧

| 概念 | ファイル |
|------|---------|
| C2PA署名 (JS Bridge) | `app/src/native/c2paBridge.ts` |
| 信頼判定 & キャッシュ | `app/src/hooks/useC2paCache.ts` |
| Title Protocol 登録 | `app/src/services/titleProtocol.ts` |
| PKI / CA (サーバー) | `web/lib/server/ca.ts` |
| 証明書発行API | `web/app/api/v1/device-certificate/route.ts` |
| Platform Attestation (iOS) | `web/lib/server/attestation-ios.ts` |
| Platform Attestation (Android) | `web/lib/server/attestation-android.ts` |
| 検証オーケストレータ | `web/lib/verify/verify.ts` |
| 共通チェック | `web/lib/verify/checks/common.ts` |
| Core C2PA チェック | `web/lib/verify/checks/core-c2pa.ts` |
| 証明書チェック | `web/lib/verify/checks/cert.ts` |
| 画像PDQチェック | `web/lib/verify/checks/image-pdq.ts` |
| 動画vPDQチェック | `web/lib/verify/checks/video-vpdq.ts` |
| PDQ計算 (純粋TS) | `web/lib/verify/pdq.ts` |
| GlobalConfig取得 | `web/lib/verify/config.ts` |
| コンテンツ解決 | `web/lib/verify/content-resolver.ts` |
| インデクサ解決 | `web/lib/verify/resolvers/indexer.ts` |
| cNFTインデクサ | `web/lib/server/cnft-indexer.ts` |
| 公開ページ コンポーネント | `web/components/ContentPage.tsx` |
| 仕様書 | `document/v0.1.0/SPECS_JA.md` |
