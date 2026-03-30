# RootLens 企画・仕様書

> **ステータス**: v0.1.0
**最終更新**: 2026-03-07
**提案者**: 森雄大、河野瞭人
**本文書の位置づけ**: RootLensアプリケーションの仕様駆動開発におけるSource of Truth
> 

---

# 1. プロダクト概要

## 1.1 RootLensとは

RootLensは、カメラで撮影された「本物のコンテンツ」であることを証明し、SNS等で共有可能なリンクとして発行するモバイルアプリケーションである。

## 1.2 解決する課題

生成AIコンテンツの急増により、「本物の写真・動画」と「生成物」の区別が困難になっている。C2PA署名によって技術的に真正性を証明できても、既存SNSにはその事実を正しく伝える仕組みがなく、撮影者が事実を信頼できる形で拡散・発信する手段が失われている。

この問題はすでに日常レベルで発生している。たとえば、偶然撮れた珍しい瞬間の動画をSNSに投稿したとき「AI生成では？」とコメントがつく。災害や事件の現場写真が「フェイクだ」と拡散され、本物の情報が埋もれる。フォトジャーナリストが撮影した写真の証拠能力が、生成AIの存在によって相対的に低下する。ペットや旅行、筋トレの写真ですら、見る側が「これは本物か？」と疑う時代になりつつある。

RootLensは、こうした場面で「これはカメラで実際に撮影されたコンテンツである」ことを、リンク一つで誰にでも示せる手段を提供する。

## 1.3 コアバリュー

現実世界を切り取った”本物”のコンテンツであることを証明し、SNSで拡散できるリンクを発行する。その証明は、リンク先の公開ページを開いた閲覧者のブラウザ内で、RootLensを含む第三者を一切信頼せずに完結する。

## 1.4 Title Protocolとの関係

RootLensは、デジタルコンテンツの出自を検証・記録する公共インフラ「Title Protocol」上に構築される最初のアプリケーションである。RootLensはTitle Protocol SDKを通じてコンテンツ検証と記録を行う。マーケットプレイスやライセンス還元等のユースケースは、Title Protocolの上に将来追加可能であり、RootLensのスコープ外とする。

RootLensがTitle Protocol上に構築されることによるメリット：

- RootLensに登録されたコンテンツの検証結果は、RootLensが消滅してもブロックチェーン上に永続する
- RootLensで登録されたコンテンツが、将来Title Protocol上に構築される別のサービスからも参照可能になる
- 検証行為のトラストレス性がTitle Protocolのアーキテクチャによって担保されるため、RootLens運営者自身が検証結果を改ざんできないことをユーザーに証明できる
- Title ProtocolのExtension機構を通じて、C2PA検証に加えpHash等の任意の検証結果をオンチェーンに記録でき、閲覧者が元のC2PA付きデータをダウンロードすることなくブラウザ内だけで表示コンテンツの同一性を検証できる

## 1.5 設計思想

### 即時利用可能なカメラ体験

RootLensは、ユーザーがアプリをインストールして開いた瞬間から、アカウント登録なしにカメラ撮影と編集を利用できる。

アカウント登録（Privy経由のメール認証またはソーシャルログイン）が必要となるのは、コンテンツを「公開」するタイミングのみである。この時点でユーザーは撮影・編集を完了しており、「この写真を本物として共有したい」という明確な動機を持っているため、登録の心理的障壁は低い。

この設計を採用する理由は、アカウント作成画面がモバイルアプリのオンボーディングにおいて最大の離脱ポイントであるという事実に基づく。RootLensのコアバリューは「本物のコンテンツを証明してSNSで共有する」ことであり、ユーザーがカメラ体験を通じてその価値を体感した後にコミットメントを求めることで、登録率を最大化する。

### 元データなしのトラストレス検証

RootLensの公開ページでは、閲覧者が「表示されている画像・動画が、Title Protocolに登録された検証済みコンテンツと同一である」ことを、RootLensを含む第三者を一切信頼せずにブラウザ内で検証できる。

これを実現するのがTitle ProtocolのExtension機構である。コンテンツの公開時、Title ProtocolノードのTEE内でC2PA検証に加えて知覚的ハッシュ（pHash）が計算され、その結果がオンチェーンに記録される。公開ページの閲覧者のブラウザは、表示画像からpHashを再計算し、オンチェーンの値と照合する。pHashは解像度の変化に対してロバストであるため、表示用にリサイズされた画像からでも照合が成立する。

この設計により、以下の3つの鎖がすべてブラウザ内で閉じる。

1. **コンテンツは本物か？** ── C2PA検証結果がTEEで計算され、Ed25519署名とともにオンチェーンに記録されている。ブラウザがEd25519署名を検証する
2. **表示されている画像は、その検証されたコンテンツと同一か？** ── TEEで計算されたpHashがオンチェーンに記録されている。ブラウザが表示画像からpHashを再計算し、オンチェーンの値と照合する
3. **オンチェーンデータ自体は改ざんされていないか？** ── Solanaブロックチェーンの不変性とArweaveの永続性が保証する

元のC2PA付きデータを閲覧者にダウンロードさせる必要がない点が重要である。閲覧者はブラウザで公開ページを開くだけで、上記3つすべてを検証できる。

### オープンソース

RootLensのソースコード（モバイルアプリ、サーバー、公開ページ）は、Apache License 2.0のもとでオープンソースとして公開する。

Title Protocolは「誰でもプロトコルを利用したアプリケーションを構築できる」ことを設計原則としている。その最初のリファレンス実装であるRootLensをオープンソースとすることで、この原則の実効性を示す。開発者はRootLensのコードを参照・フォークすることで、Title Protocol上のアプリケーション開発を加速できる。

なお、RootLens Root CAの秘密鍵はAWS KMSで管理されるインフラ運用上の秘密であり、ソースコードの公開範囲には含まれない。Root CA証明書の生成スクリプトは公開するが、KMS鍵IDは環境変数として扱う。

---

# 2. ユーザーフロー

## 2.1 初回起動

1. ユーザーがアプリをインストールして開く
2. 端末TEE内でEC P-256の鍵ペアが自動生成される
3. Platform Attestation（Android: Key Attestation + Play Integrity / iOS: App Attest）を実行し、PKCS#10形式のCSRとともにRootLensサーバーに送信する。サーバーがAttestation証拠を検証し、Device Certificateを発行する（詳細は「4.4 証明書発行フロー」参照）
4. ホーム画面（公開済みギャラリー）が表示される。初回は空なので端末ギャラリーへの誘導を表示する

※アカウント登録はこの時点では不要。カメラ撮影と編集はログインなしで利用可能。

## 2.2 撮影・選択

1. 端末のカメラ（RootLensカメラ）で撮影する、または端末ギャラリーからC2PA署名付きコンテンツを選択する
2. RootLensカメラで撮影した場合、撮影直後にオフラインでC2PA署名が端末側で付与される

## 2.3 編集

1. コンテンツを選択すると編集画面に進む
2. 編集操作は「元データから情報を減らす操作」のみ許可される（クロップ、マスク、動画トリミング、画質低下等）
3. 編集を行うとRootLens署名がC2PA来歴に追加される
4. 編集なしでハードウェア署名のまま公開することも可能
5. 途中保存（ドラフト）はローカルに保持される

## 2.4 公開

1. 編集完了後、公開ボタンを押す
2. 未ログインの場合、Privy経由でアカウント登録・ログインを求める（メール認証またはソーシャルログイン）
3. 以下の処理が実行される（詳細は「6. 公開パイプライン」参照）
4. 完了後、公開ページのリンクが発行される
5. アプリ内で公開ページをプレビュー可能
6. リンクをコピーしてSNS等で共有可能

## 2.5 SNS共有

1. Xなどで公開ページリンクを投稿する
2. OGPにより「Shot on RootLens」帯付きのサムネイルが表示される
3. リンク先の公開ページで検証結果の詳細を誰でも閲覧できる

---

# 3. UI設計

## 3.1 UI表現の原則

### 3.1.1 基本方針

RootLensのユーザーは、ブロックチェーン、C2PA、暗号鍵といった技術的概念を理解している必要はない。UI上のすべてのテキストは、これらの概念を知らない一般ユーザーが迷わずに操作できることを最優先とする。

### 3.1.2 用語マッピング

UI上で使用する表現と、内部の技術的実体の対応を以下に定める。技術用語をUIに直接表示してはならない。

| 内部の技術的実体 | UI上の表現 | 使ってはいけない表現 |
| --- | --- | --- |
| Privyアカウント / Solanaウォレット | アカウント | ウォレット、秘密鍵、公開鍵、キーペア |
| cNFTの発行 | 公開（の完了） | ミント、NFT、トークン発行、ブロックチェーンへの記録 |
| C2PA署名 / ハードウェア署名 | 本物証明 | C2PA、署名、マニフェスト、来歴 |
| Title Protocolへの登録 | 本物証明の記録 | プロトコル登録、オンチェーン記録 |
| content_hash | （表示しない） | ハッシュ、識別子 |
| Privyウォレットアドレス | アカウントID | アドレス、パブリックキー |
| cNFTのBurn | 記録の削除 | バーン、焼却、トークン破棄 |
| gas代 | （表示しない。RootLensが負担するため） | ガス代、手数料、トランザクション費用 |
| Extension cNFT | （表示しない。公開ページの「本物証明」表示に吸収） | Extension、拡張属性 |
| pHash照合 | （表示しない。公開ページの検証インジケーターに吸収） | 知覚的ハッシュ、pHash、ハミング距離 |

**例外：** 設定画面のウォレットセクションは、SOLの送金や残高確認を行うユーザー向けであり、この文脈ではSolanaアドレス、SOL残高等の暗号資産用語の使用を許容する。ただし、このセクションに到達するまでの導線上では技術用語を使用しない。

### 3.1.3 本物証明の表示基準

公開ページおよびアプリ内で本物証明のステータスを表示する際は、以下の基準に従う。信頼レベルの技術的定義は「4.1 信頼モデル」を参照。

| 信頼レベル | 表示例 | 補足表示 |
| --- | --- | --- |
| ハードウェアレベル | 「Shot on Google Pixel」「Shot on Nikon Z9」 | デバイス名を明示。最も強い証明であることが伝わる表現を用いる |
| アプリレベル | 「Shot on RootLens」 | RootLensによる証明であることを明示 |
| 編集あり | 「Shot on [デバイス名], Edited on RootLens」 | 編集履歴がある場合は必ず付記する |

**禁止事項：**

- ハードウェアレベルとアプリレベルの証明を、同等の強度であるかのように表示してはならない。表示の差異（デバイス名 vs アプリ名）によって自然に区別されるが、意図的に同列に見せるデザインは避ける
- 「100%本物」「完全に証明済み」等の絶対的な表現は使用しない。証明は技術的な仕組みに基づくものであり、絶対性を主張するものではない
- 「ブロックチェーンで証明」「改ざん不可能」等の技術的権威に訴える表現をメインの訴求として使用しない。ユーザーにとって重要なのは「本物かどうか」であり、その裏側の技術ではない

### 3.1.4 エラー・例外状態の表示

技術的な失敗をユーザーに伝える際は、原因ではなく次のアクションを中心に表示する。

| 技術的な状態 | UI上の表示例 | 使ってはいけない表現 |
| --- | --- | --- |
| Title Protocolノードへの接続失敗 | 「公開できませんでした。もう一度お試しください」 | ノード接続エラー、TEE検証失敗 |
| C2PA署名検証の失敗 | 「このコンテンツの本物証明を確認できませんでした」 | 署名チェーン不正、マニフェスト検証エラー |
| Solanaトランザクション失敗 | 「公開処理中にエラーが発生しました。もう一度お試しください」 | トランザクション失敗、Blockhash期限切れ |
| オフライン状態での公開試行 | 「公開にはインターネット接続が必要です」 | ネットワークエラー |
| Arweaveへのアップロード失敗 | 「公開できませんでした。もう一度お試しください」 | ストレージエラー、Arweaveアップロード失敗 |

リトライで解決する可能性がある場合は、リトライボタンを表示する。繰り返し失敗する場合は「しばらく時間をおいてお試しください」に切り替える。

## 3.2 画面構成

アプリはフッターナビゲーションで3つのセクションに分かれる。

| 位置 | ボタン | 画面名 | 役割 |
| --- | --- | --- | --- |
| 左 | アイコン | 公開済みギャラリー | ホーム画面。公開済みコンテンツと編集途中ドラフトの一覧 |
| 中央 | 丸いカメラボタン | カメラ | 写真・動画撮影 |
| 右 | アイコン | 端末ギャラリー | 端末内の全コンテンツ一覧。C2PA署名付きのみ選択可能 |

上記に加え、以下のサブ画面が存在する。

| 画面名 | 遷移元 | 役割 |
| --- | --- | --- |
| 編集画面 | カメラ撮影後 / 端末ギャラリーでのコンテンツ選択 | コンテンツの編集と公開 |
| 公開ページプレビュー | 公開完了後 / 公開済みギャラリーからの選択 | 公開ページのアプリ内プレビュー（iframe） |
| 設定画面 | 公開済みギャラリー右上の歯車アイコン | ウォレット情報、残高確認、ユーザー名設定等 |

## 3.3 公開済みギャラリー（ホーム画面）

- アプリ起動時に最初に表示される画面
- 3列グリッドレイアウト（Xのメディア欄と同様の形式）
- 公開済みコンテンツと、編集途中のドラフトが並ぶ
- ドラフトにはバッジが表示され、途中であることが視覚的にわかる
- コンテンツが0件の場合は、端末ギャラリーへの誘導UIを表示する
- 右上に歯車アイコン（設定画面への遷移）
- 公開済みコンテンツを選択すると公開ページプレビューに遷移
- ドラフトを選択すると編集画面に遷移

## 3.4 カメラ

- フッター中央の丸いカメラボタンで起動
- 写真と動画の両方に対応
- シンプルで使いやすい標準的なカメラUI
- 撮影後、オフラインでC2PA署名を端末側で付与
- 撮影完了後、編集画面に遷移可能

## 3.5 端末ギャラリー

- 端末内の全画像・動画を3列グリッドで表示
- C2PA署名チェックの結果に応じて表示が分かれる：
    - **選択可能**：RootLensカメラで撮影したもの、またはホワイトリストに含まれるハードウェア署名付き撮って出しコンテンツ。バッジ表示あり（例：「Google Pixel」「Canon」「RootLens」等、署名元に応じた色分け）
    - **グレーアウト**：上記以外のコンテンツ。選択不可
- 複数コンテンツの一括選択が可能
- 選択後、編集画面に遷移

### C2PAスキャン仕様

- アプリがフォアグラウンドにある間、新しいコンテンツから順次C2PA検証を実行する
- 検証結果はローカルにキャッシュする（コンテンツのハッシュ値等のIDと紐づけて保持）
- 2回目以降はキャッシュを参照し、再スキャンしない

## 3.6 編集画面

- コンテンツのプレビューと編集操作UIを表示
- 許可される編集操作は「元データから情報を減らす操作」のみ。色調変更、フィルター、合成等の「情報を加える・変質させる」編集は許可しない。RootLensのコアバリューは「本物のコンテンツであること」の証明であり、情報を加える編集を許可するとその証明の意味が曖昧になるためである。情報の削減は、空間的（クロップ）、時間的（動画トリミング）、視覚的（マスク）、精度的（画質低下）のいずれであっても、新たな情報を加えない操作であるため、追加・合成とは性質が異なる：
    - クロップ（空間的な情報の削減）
    - マスク（視覚的な情報の削減）
    - 動画トリミング（時間的な情報の削減）
    - 画質低下（精度的な情報の削減。解像度の縮小等）
    - その他、「元データに情報を加えるのではなく減らすだけ」の操作は追加可能
- 編集操作はすべてC2PAの編集履歴として記録される（技術的詳細は「4.5 C2PAマニフェスト」参照）
- 未編集のままでも公開可能（ハードウェア署名のみで公開される）
- 複数コンテンツを一括選択している場合は、個別に編集操作を適用
- 途中保存でドラフトとしてローカルに保持（公開済みギャラリーにバッジ付きで表示される）
- 「公開」ボタンで公開パイプラインを起動（未ログインの場合はPrivy経由のログインを先に求める）

## 3.7 公開ページプレビュー

- 公開完了後、または公開済みギャラリーからコンテンツを選択した際に表示
- iframeでrootlens.io上の公開ページを表示
- リンクコピーボタン
- SNS共有ボタン（X等）

## 3.8 設定画面

- 公開済みギャラリー画面の右上歯車アイコンから遷移
- 表示内容：
    - **アカウント情報**
        - ログイン中のアカウント情報（メールアドレスまたはソーシャルアカウント）
        - アカウントID（内部ID）の表示
        - ユーザー名設定（公開ページでの表示名。将来的な検討項目）
        - ログアウト
    - **ウォレット**
        - Privyウォレットのアドレス（Solanaアドレス）の表示・コピー
        - SOL残高の確認
        - ウォレットからのSOL送金（transfer）機能
    - **サブスクリプション管理**

---

# 4. 署名アーキテクチャ

## 4.1 信頼モデル

### 4.1.1 設計の位置づけ

RootLensの署名アーキテクチャは、ハードウェアメーカー（Canon、Nikon、Google Pixel等）が自社デバイスをC2PA署名の信頼の傘に入れる構造と対称的なものである。ハードウェアメーカーは「工場出荷時にセキュアチップへ鍵をバインドし、自社Root CAでデバイス証明書に署名する」ことで信頼チェーンを構築する。RootLensは「アプリインストール時にTEE内で鍵を生成し、Platform Attestationで正規環境を検証した上でRootLens Root CAでDevice Certificateに署名する」ことで、同じPKI構造の信頼チェーンを構築する。

両者の違いは、信頼の起点が何を保証しているかにある。ハードウェアメーカーはセンサーから署名までの経路を自社が管理していることを保証する。RootLensは、正規のアプリが改ざんされていない端末のTEE内で署名したことを、Google/AppleのPlatform Attestation基盤に依存する形で保証する。

### 4.1.2 本物証明の信頼レベル

| 信頼レベル | 署名元 | 信頼の根拠 | 証明の範囲 |
| --- | --- | --- | --- |
| ハードウェアレベル | Google Pixel（Titan M2）、Nikon、Canon、Sony等 | 端末のセキュアチップがセンサーから直接署名する | コンテンツがそのハードウェアのセンサーで取得された未改ざんのデータであること |
| アプリレベル | RootLens | Platform Attestation（端末検証）+ RootLens Root CA | 正規のRootLensアプリが、改ざんされていない端末のTEE内で署名したこと |

ハードウェアレベルの署名は、センサーからの信号を直接暗号化するため、OSレベルの介入（仮想カメラ、画面キャプチャの注入等）を原理的に排除できる。

アプリレベルの署名（RootLens署名）は、Platform Attestation（Android: Key Attestation + Play Integrity、iOS: App Attest）により端末の正当性とアプリの改ざん防止を検証した上でDevice Certificateを発行するが、カメラセンサーから署名までの経路はOSを経由するため、ハードウェアレベルと同等のセンサー直結の保証は提供しない。

**この設計上のトレードオフは意図的なものである。** C2PA対応ハードウェア（Titan M2搭載のPixel、Nikon Z9等）の普及はまだ限定的であり、ハードウェア署名の普及を待っていてはTitle Protocolのコールドスタート問題を解決できない。RootLensは、対応ハードウェアを持たないユーザーにもアプリレベルの本物証明を提供することで、エコシステム全体のコンテンツ登録数を確保する。

なお、撮影時にアプリが署名を付与するというアプローチ自体は、同領域の既存サービス（Numbers Protocol等）と共通する。ただし、RootLensはPlatform Attestationによる鍵のハードウェア保護と、Title ProtocolのTEEによるトラストレスな検証パイプラインにより、署名から記録までの信頼性において構造的な優位を持つ。

公開ページでは、この信頼レベルの違いを署名元の表示（「Shot on Google Pixel」vs「Shot on RootLens」）によって明示する。ハードウェア署名付きコンテンツはより強い証明として扱われ、RootLens署名はアプリが提供できる範囲の証明として正直に位置づけられる。

将来的にC2PA対応ハードウェアが普及した場合でも、RootLens上でそれらのハードウェア署名付きコンテンツを引き続き公開できるため、RootLens署名の信頼モデルに依存しない形でプラットフォームの価値は維持される。

### 4.1.3 編集と信頼の階層

| 状態 | C2PA署名チェーン | 公開ページでの表示 |
| --- | --- | --- |
| ハードウェア撮影 → 編集なし → 公開 | ハードウェア署名のみ | 「Shot on Google Pixel」等 |
| ハードウェア撮影 → RootLensで編集 → 公開 | ハードウェア署名 + RootLens署名 | 「Shot on Google Pixel, Edited on RootLens」等 |
| RootLensカメラで撮影 → 編集なし → 公開 | RootLens署名のみ | 「Shot on RootLens」 |
| RootLensカメラで撮影 → RootLensで編集 → 公開 | RootLens署名（撮影+編集） | 「Shot on RootLens」（編集履歴付き） |

## 4.2 暗号アルゴリズム

RootLensのC2PA署名で使用する暗号アルゴリズムは **ES256（ECDSA P-256 with SHA-256）** とする。

この選定は、以下の4つのレイヤーすべてが共通してサポートするアルゴリズムの交差点として導出されたものである。

| レイヤー | ES256 (P-256) | ES384 (P-384) | EdDSA (Ed25519) | PS256 (RSA) |
| --- | --- | --- | --- | --- |
| C2PA仕様 v2.2 | ✓ | ✓ | ✓ | ✓ |
| iOS Secure Enclave | ✓ | ✗ | ✗ | ✗ |
| Android StrongBox | ✓ | ✗ | ✗ | ✓ |
| AWS KMS | ✓ | ✓ | ✗ | ✓ |

iOS Secure EnclaveがP-256のみをサポートするため、他の選択肢はすべて排除される。ES256はC2PA Implementation Guidanceの推奨アルゴリズムでもあり、エコシステムで最も広く実装・テストされている。

以降、本仕様書で「C2PA署名」と記載する場合は、すべてES256を使用するものとする。ハッシュアルゴリズムにはSHA-256を使用する（C2PA推奨に準拠）。

## 4.3 PKI構造

RootLensは3層のPKI構造でC2PA署名の信頼チェーンを構築する。プラットフォーム別の中間CA（Intermediate CA）を設け、iOS/Androidを暗号的に分離する。

| 層 | 名称 | 保管場所 | 役割 |
| --- | --- | --- | --- |
| ルート | RootLens Root CA | AWS KMS（ECC_NIST_P256鍵） | 信頼の起点。Intermediate CAに署名する |
| 中間 | iOS Intermediate CA | AWS KMS | iOS端末のDevice Certificateに署名する |
| 中間 | Android Intermediate CA | AWS KMS | Android端末のDevice Certificateに署名する |
| デバイス | Device Certificate | 端末TEE内 | 端末ごとに発行。C2PA署名に使用する |

```
Root CA (pathLenConstraint:1, 20年)
  ├── iOS Intermediate CA (pathLenConstraint:0, 5年)
  │     └── iOS Device Certificate (90日)
  └── Android Intermediate CA (pathLenConstraint:0, 5年)
        └── Android Device Certificate (90日)
```

**プラットフォーム分離の理由:** Apple App AttestとGoogle Key Attestation + Play Integrityは根本的に異なるAttestation機構である。一方のプラットフォームで不正が発覚した場合（例: Apple App Attestの脆弱性）、当該プラットフォームのIntermediate CAを失効させることで、そのプラットフォームの全Device Certificateを即座に無効化できる。他方のプラットフォーム（Android）のIntermediate CAとそのDevice Certificateは暗号的に完全に独立しており、影響を受けない。

C2PA署名鍵はアカウントとは独立に、アプリインストール時に端末TEE内で生成される。アプリを再インストールした場合、端末のKeychainまたはKeyStoreに既存のDevice Certificateと鍵ペアが残っていればそれを再利用する。残っていない場合のみ新規発行される。旧Device Certificateで署名済みのコンテンツは、署名チェーン（Root CA → Intermediate CA → 旧Device Certificate → コンテンツ署名）がC2PAマニフェスト内に完結しているため、新Device Certificateの発行後も検証可能性に影響しない。

### 4.3.1 Root CA証明書プロファイル

Root CA鍵はAWS KMSで生成・管理する（鍵タイプ: ECC_NIST_P256、用途: SIGN_VERIFY）。鍵はKMS外に抽出できない。CloudHSM（FIPS 140-2 Level 3）ではなくKMS（FIPS 140-2 Level 2）を選定する理由は、Root CA鍵の使用頻度が「Intermediate CA発行時のみ」と極めて低く、高スループットが不要であること、コストと運用負荷の差が大きいこと、Level 2がRootLensのユースケースに十分であることによる。

```
X.509 v3 Certificate
  Version: 3
  Serial Number: ランダム生成（20バイト）
  Signature Algorithm: ecdsa-with-SHA256
  Issuer: CN=RootLens Root CA, O=<法人名>, C=JP
  Validity:
    Not Before: 発行日
    Not After: 発行日 + 20年
  Subject: CN=RootLens Root CA, O=<法人名>, C=JP
  Subject Public Key Info:
    Algorithm: id-ecPublicKey (P-256)
  Extensions:
    Basic Constraints: critical, CA:TRUE, pathLenConstraint:1
    Key Usage: critical, keyCertSign, cRLSign
    Subject Key Identifier: <公開鍵のSHA-1ハッシュ>
```

`pathLenConstraint: 1` により、Root CAの直下に1層の中間CA（Intermediate CA）を配置できる。Intermediate CAの `pathLenConstraint: 0` により、Device Certificateがさらに下位の証明書を発行することを暗号的に防止する。

### 4.3.1b Intermediate CA証明書プロファイル

プラットフォーム別（iOS / Android）に1つずつ発行する。

```
X.509 v3 Certificate
  Version: 3
  Serial Number: ランダム生成（20バイト）
  Signature Algorithm: ecdsa-with-SHA256（Root CAによる署名）
  Issuer: CN=RootLens Root CA, O=<法人名>, C=JP
  Validity:
    Not Before: 発行日
    Not After: 発行日 + 5年
  Subject: CN=RootLens iOS CA (or Android CA), O=<法人名>, C=JP
  Subject Public Key Info:
    Algorithm: id-ecPublicKey (P-256)
  Extensions:
    Basic Constraints: critical, CA:TRUE, pathLenConstraint:0
    Key Usage: critical, keyCertSign, cRLSign
    Subject Key Identifier: <公開鍵のSHA-1ハッシュ>
    Authority Key Identifier: <Root CAのSubject Key Identifier>
```

### 4.3.2 Device Certificateプロファイル

```
X.509 v3 Certificate
  Version: 3
  Serial Number: ランダム生成（20バイト）
  Signature Algorithm: ecdsa-with-SHA256（Intermediate CAによる署名）
  Issuer: CN=RootLens iOS CA (or Android CA), O=<法人名>, C=JP
  Validity:
    Not Before: 発行日
    Not After: 発行日 + 90日
  Subject: CN=RootLens Device <device_id_hash先頭16文字>
  Subject Public Key Info:
    Algorithm: id-ecPublicKey (P-256)
    Public Key: 端末TEE内で生成された公開鍵
  Extensions:
    Basic Constraints: critical, CA:FALSE
    Key Usage: critical, digitalSignature
    Extended Key Usage: id-kp-documentSigning (1.3.6.1.5.5.7.3.36)
    Subject Key Identifier: <公開鍵のSHA-1ハッシュ>
    Authority Key Identifier: <Root CAのSubject Key Identifier>
```

Extended Key Usageには、C2PA v2.2で代替デフォルトEKUとして認められた `id-kp-documentSigning`（RFC 9336）を使用する。C2PA独自の `c2pa-kp-claimSigning` EKUはC2PA Trust Listに登録されたCAが使用するものであり、RootLens独自CAでは `id-kp-documentSigning` が適切である。

Device Certificateの有効期限は90日とする。短期有効期限により、侵害された鍵の影響範囲を時間的に限定する。過去に署名されたコンテンツの検証可能性はRFC 3161タイムスタンプにより保証される（§4.5.3参照）。

**device_id_hash の定義：** Device CertificateのSubject CNに含める `device_id_hash` は、CSRに含まれる公開鍵のDERエンコードのSHA-256ハッシュ先頭16文字（hex）とする。公開鍵から一意に決まり、再計算可能である。

### 4.3.3 Root CA証明書の初期構築

Root CA証明書はRootLensの運用開始時に一度だけ生成する。手順は以下の通り。

1. AWS KMSコンソールまたはCLIで非対称鍵を作成する（`ECC_NIST_P256`、`SIGN_VERIFY`用途）
2. `GetPublicKey` APIで公開鍵（DER形式）を取得する
3. Root CA証明書のtbsCertificate（署名前の証明書本体）をDERエンコードで組み立てる。Subject/Issuer、Extensions等は前述のRoot CA証明書プロファイルに従う
4. tbsCertificateのSHA-256ダイジェストを計算する
5. KMS `Sign` API（`ECDSA_SHA_256`）でダイジェストに署名する
6. tbsCertificate + signatureAlgorithm + signature を結合してX.509 DERを完成する
7. 生成した証明書を検証する（`openssl x509 -in rootca.pem -text -noout`）
8. Root CA証明書をアプリバンドルとサーバーの設定に組み込む

この手順はスクリプト化し、リポジトリに含める（秘密鍵はKMS内にあるため、スクリプト自体は秘密情報を含まない）。

## 4.4 証明書発行フロー

### 4.4.1 フロー詳細（初回起動時）

1. アプリが端末TEE内でEC P-256の鍵ペアを生成する
    - Android: `KeyGenParameterSpec` に `setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))` を指定。`setIsStrongBoxBacked(true)` をStrongBox対応端末で設定（非対応の場合はTEEにフォールバック）
    - iOS: `kSecAttrKeyTypeECSECPrimeRandom` + `kSecAttrKeySizeInBits: 256` + `kSecAttrTokenIDSecureEnclave` を指定
2. アプリがCSR（Certificate Signing Request、PKCS#10形式）を作成する。CSRにはTEE内で生成された公開鍵が含まれ、TEE内の秘密鍵で自己署名される（Proof of Possession）
3. 端末がPlatform Attestationを実行する。challengeには **CSRのSHA-256ハッシュ** を使用する
    - Android: Key Attestation（`setAttestationChallenge(SHA256(csrDer))`）+ Play Integrity API（nonceにSHA-256(csrDer)を設定）
    - iOS: App Attest（`DCAppAttestService.attestKey` の `clientDataHash` に `SHA256(csrDer)` を渡す）
4. CSR + Attestation証拠をRootLensサーバーの証明書発行エンドポイントに送信する
5. サーバーが検証する（詳細は「4.4.2 証明書発行API」参照）
6. 検証に通過したら、AWS KMS Sign APIを使用してDevice Certificateに署名して発行する
7. 端末にDevice Certificateおよび Root CA証明書を返却する。端末はTEE内の秘密鍵とペアで保持する

**challengeにCSRハッシュを使用する理由：** Attestation証拠とCSRの紐づけは、Android Key Attestationではattestation証明書の公開鍵とCSRの公開鍵の一致で保証される。iOS App AttestではC2PA署名鍵と独立しているため、`clientDataHash` にCSRハッシュを埋め込むことで紐づけを実現する。CSRに含まれる公開鍵はTEE内で新規生成されるたびに一意であるため、CSRハッシュも一意となり、専用のchallenge発行エンドポイントとサーバー側のnonce管理が不要になる。ネットワーク往復も1回削減される。

**ハードウェアバックされていない鍵への対応：** Attestation SecurityLevelがSOFTWARE（Android）である場合、またはSecure Enclaveが利用できない場合（iOS、実質的に存在しない）は、Device Certificateの発行を拒否する。RootLens署名の信頼の根拠であるPlatform Attestationの前提が満たされないためである。

※Device Certificate発行はアカウント登録とは独立したプロセスである。アプリインストール直後にログインなしで実行され、カメラ撮影時のC2PA署名を可能にする。

### 4.4.2 証明書更新フロー

Device Certificateの有効期限は90日であるため、アプリは定期的に証明書を更新する必要がある。

1. アプリ起動時にDevice Certificateの `notAfter` を確認する
2. 残り14日以内の場合、バックグラウンドで更新フローを開始する
3. 更新は初回発行と同じフロー（CSR生成 → Attestation → サーバー発行）で行う。TEE内の鍵ペアは変更しない（同じ鍵に対する新しい証明書を発行する）
4. 新しいDevice Certificateを受け取ったら、ローカルに保存されている証明書を置き換える
5. 旧証明書は失効させない。旧証明書で署名されたコンテンツのRFC 3161タイムスタンプが有効期間内であれば、検証は成功する

**更新失敗時の挙動：** ネットワーク障害等で更新に失敗した場合、証明書の有効期限が切れるまでは既存の証明書で署名を継続する。有効期限切れの場合、C2PA署名なしで撮影・編集を許可するが、ユーザーに「本物証明が一時的に利用できません」と通知する。

```
POST /api/v1/device-certificate/renew
Content-Type: application/json
```

リクエスト・レスポンスのフォーマットは初回発行（§4.4.3）と同一。

### 4.4.3 証明書発行API

### エンドポイント

```
POST /api/v1/device-certificate
Content-Type: application/json
```

認証不要（アカウント登録前に実行される）。IPベースのレートリミットとAttestation検証により不正リクエストを防止する。

### リクエスト

```json
{
  "platform": "android" | "ios",
  "csr": "<Base64エンコードされたPKCS#10 CSR（DER形式）>",
  "attestation": {
    // --- Androidの場合 ---
    "key_attestation_chain": [
      "<Base64 DER: Attestation証明書>",
      "<Base64 DER: Intermediate>",
      "<Base64 DER: Google Root>"
    ],
    "play_integrity_token": "<Play Integrity APIトークン>",

    // --- iOSの場合 ---
    "app_attest_object": "<Base64: CBOR attestation object>",
    "app_attest_key_id": "<App Attestの鍵ID>"
  }
}
```

専用のchallenge発行エンドポイントは設けない。Attestation実行時のchallengeには `SHA-256(CSR)` を使用し、サーバーは受け取ったCSRから同じハッシュを再計算して検証する。これにより、CSRとAttestation証拠の紐づけをサーバー側のnonce管理なしで保証する。

### CSRフォーマット（PKCS#10）

CSRには以下が含まれる。

- Subject: `CN=RootLens Device`（サーバーが最終的なSubject DNを設定するため、クライアント指定値は上書きされる）
- SubjectPublicKeyInfo: TEE内で生成されたEC P-256公開鍵
- Signature: TEE内の秘密鍵によるECDSA-SHA256自己署名（Proof of Possession）

### サーバー側検証ロジック（Android）

1. CSRの署名を検証（公開鍵がCSR自身に署名していることを確認）
2. Key Attestation チェーンの検証
    1. `key_attestation_chain[0]` の公開鍵がCSRの公開鍵と一致することを確認
    2. チェーンをGoogle Hardware Attestation Root CAまで検証（Root CA証明書はGoogleが公開しているものをpin留め）
    3. Attestation Extension（OID: `1.3.6.1.4.1.11129.2.1.17`）を解析し、以下を確認:
        - `attestationSecurityLevel` が `TRUSTED_ENVIRONMENT(1)` または `STRONGBOX(2)` であること。`SOFTWARE(0)` の場合は拒否
        - `purpose` に `SIGN(2)` が含まれること
        - `algorithm` が EC であること
        - `attestationApplicationId.packageInfos` にRootLensの正規パッケージ名が含まれること
        - `attestationChallenge` が `SHA-256(CSR)` と一致すること
3. Play Integrity Token の検証
    1. Google Play Integrity APIでトークンをデコード
    2. 以下を確認:
        - `requestDetails.requestPackageName` がRootLensの正規パッケージ名と一致
        - `requestDetails.nonce` が `SHA-256(CSR)` のBase64と一致
        - `appIntegrity.appRecognitionVerdict` が `PLAY_RECOGNIZED`
        - `deviceIntegrity.deviceRecognitionVerdict` に `MEETS_DEVICE_INTEGRITY` を含む
4. 全検証パス → AWS KMS Sign APIでDevice Certificateに署名して発行

### サーバー側検証ロジック（iOS）

1. CSRの署名を検証（Proof of Possession）
2. App Attest の検証
    1. Attestation objectをCBORデコードで解析
    2. Apple App Attest Root CAまでの証明書チェーンを検証（Root CA証明書はAppleが公開しているものをpin留め）
    3. 以下を確認:
        - `rpIdHash` がRootLensのApp IDと一致
        - `counter` が0（初回attestation）
        - `aaguid` がAppleの本番環境のものであること
        - `clientDataHash` が `SHA-256(CSR)` と一致すること
    4. Attestation receiptを検証

**iOSにおけるApp AttestとSecure Enclave鍵の関係：** App Attestの鍵とC2PA署名用のSecure Enclave鍵は技術的に独立したものである。App Attestは「このアプリが正規品であり、改ざんされていない端末で動作している」ことを証明する。C2PA署名用鍵は「Secure Enclave内に秘密鍵が存在する」ことがCSRのProof of Possessionで証明される。`clientDataHash` にCSRのハッシュを使用することで、「このApp Attestは、このCSRに含まれる鍵を持つ端末で実行された」という紐づけが成立する。

### レスポンス

```json
{
  "device_certificate": "<Base64エンコードされたX.509 DER>",
  "root_ca_certificate": "<Base64エンコードされたX.509 DER>",
  "device_id": "<公開鍵SHA-256先頭16文字hex>"
}
```

### エラーレスポンス

| HTTPステータス | 原因 | クライアント対応 |
| --- | --- | --- |
| 400 | CSR形式不正、Attestation証拠欠落 | リクエスト修正後にリトライ |
| 403 | Attestation検証失敗（非対応端末、改ざん検知等） | リトライ不可。ユーザーに「この端末では本物証明を利用できません」と表示 |
| 429 | レートリミット超過 | 時間を置いてリトライ |
| 500 | サーバー内部エラー（KMS障害等） | リトライ |

## 4.5 C2PAマニフェスト

### 4.5.1 COSE署名構造

C2PAマニフェストの署名はCOSE Sign1形式で行い、protectedヘッダーの `x5chain`（RFC 9360）に証明書チェーンを含める。

```
COSE_Sign1 = [
  protected: {
    alg: -7  (ES256)
    x5chain: [
      <Device Certificate (DER)>,
      <Root CA Certificate (DER)>
    ]
  },
  unprotected: {
    sigTst2: <RFC 3161 タイムスタンプ>（取得できた場合）
  },
  payload: <Claim (DER)>,
  signature: <TEE内の秘密鍵で生成したECDSA P-256署名>
]
```

C2PA v2.2は「すべての中間X.509証明書をCOSE署名に含めなければならない」と規定する。RootLensは3層構造（Root CA → Intermediate CA → Device Certificate）のため、`x5chain` にはDevice Certificate、Intermediate CA証明書、Root CA証明書の3つを含める。

### 4.5.2 編集時のマニフェスト構造

編集操作を行った場合、C2PAの標準的なingredient + actionsパターンに従い、以下のマニフェストを構築する。

**ingredientアサーション：** 編集元のコンテンツ（ハードウェア署名付き撮って出し、またはRootLensカメラ撮影済み）のC2PAマニフェストを `c2pa.ingredient` アサーションとして参照する。これにより、「このコンテンツはどのコンテンツから派生したか」の来歴チェーンが保持される。

**actionsアサーション（`c2pa.actions.v2`）：** 編集操作を以下のC2PA標準アクションで記録する。

| 編集操作 | C2PAアクション | 説明 |
| --- | --- | --- |
| クロップ | `c2pa.cropped` | 空間的な情報の削減 |
| マスク | `c2pa.drawing` + リージョン指定 | マスクされた領域の記録 |
| 動画トリミング | `c2pa.trimmed` | 時間的な情報の削減 |
| 画質低下（リサイズ等） | `c2pa.resized` | 精度的な情報の削減 |

各アクションにはパラメータ（クロップ領域、トリミング範囲等）を含め、何が行われたかを検証可能にする。アクション種別はC2PA仕様の標準定義に従い、RootLens独自のアクション定義は設けない。

**署名：** 編集後のマニフェストは、同じDevice Certificate（同じTEE鍵）で署名する。撮影時と編集時の署名者が同じであることは、同一端末での操作であることの証拠となる。

### 4.5.3 タイムスタンプ

C2PA仕様は署名時のRFC 3161タイムスタンプの添付を強く推奨しており、Title Protocolもデフォルトでタイムスタンプの存在を検証対象とする。RootLensではDevice Certificateの有効期限を90日としているため、タイムスタンプは過去のコンテンツの検証可能性を保証する上で **必須の要素** である。

**原則：** C2PA署名時にネットワークが利用可能であれば、TSA（Time Stamping Authority）からRFC 3161タイムスタンプを取得し、COSE unprotectedヘッダーの `sigTst2` に添付する。撮影時・編集時いずれの署名においても同様である。TSAにはDigiCert等の既存の信頼されたTSAサービスを使用し、自前構築はしない。

**タイムスタンプと短期証明書の関係：** Device Certificateの有効期限が切れた後も、RFC 3161タイムスタンプが「署名が証明書の有効期間内に行われた」ことを第三者的に証明するため、コンテンツの検証は引き続き成功する。この仕組みは業界標準であり、TLS証明書（90日有効期限）と同様のモデルである。

**オフライン時の挙動：** ネットワークが利用できない場合は、C2PA署名のみ実行しタイムスタンプなしで保存する。TSAタイムスタンプが付与されていないコンテンツについては、Title Protocol側がブロックチェーンの登録タイムスタンプを時刻根拠とする。ただし、Device Certificateの有効期限後にはC2PA署名の検証は「証明書の有効期限切れ」として失敗する可能性がある。

## 4.6 C2PA SDK統合

### 4.6.1 アーキテクチャ

C2PAマニフェストの構築・署名・画像への埋め込みにはc2pa-rs（Rust SDK）を使用する。React Nativeアプリからの呼び出しは、ネイティブモジュール経由で行う。

```
[React Native JS層]
  │  await signContent(imagePath, editActions)
  ▼
[ネイティブモジュール (Kotlin / Swift)]
  │  c2pa-cのFFI呼び出し
  ▼
[c2pa-rs (static libraryとしてiOS/Androidにリンク)]
  │  マニフェスト構築 → ハッシュ計算 → 署名要求
  │  ↕ 署名コールバック（Signerトレイト実装）
  ▼
[TEE API (Android KeyStore / iOS SecKey)]
  │  ECDSA P-256署名をTEE内で実行
  ▼
[c2pa-rs]
  → 署名付きJPEG/PNG/MOVを出力
```

c2pa-rsの `Signer` トレイトをカスタム実装し、署名処理のみをプラットフォームネイティブのTEE APIにコールバックさせる。c2pa-cはc2pa-rsのC言語バインディングであり、Kotlin（JNI経由）およびSwift（C bridging header経由）から呼び出す。

c2pa-rsはiOS（aarch64-apple-ios）およびAndroid（aarch64-linux-android等）ターゲットにクロスコンパイルし、各プラットフォームのstatic library（`.a` / `.so`）としてReact Nativeのネイティブモジュールにリンクする。

### 4.6.2 ネイティブモジュールIF

React NativeのJS層には、TEE操作やC2PA構造の詳細を一切露出させない。ネイティブモジュールは以下の関数をJS層に公開する。

| 関数 | 引数 | 返り値 | 処理内容 |
| --- | --- | --- | --- |
| `generateDeviceCredentials()` | なし | `{csr, attestation, platform}` | TEE鍵生成 + CSR作成 + Attestation取得。Device Certificateの申請に必要な一式を返す |
| `signContent(imagePath, actions?)` | 画像/動画パス、編集操作リスト（任意） | 署名済みファイルパス | C2PAマニフェスト構築 + TEE署名 + ファイル埋め込みを一括実行 |
| `signEditedContent(imagePath, originalManifestPath, actions)` | 編集後パス、元のマニフェスト情報、編集操作リスト | 署名済みファイルパス | 元コンテンツをingredientとして参照し、編集履歴付きの新しいマニフェストを構築・署名 |
| `hasDeviceCertificate()` | なし | boolean | 有効なDevice Certificateが端末に存在するかを返す |
| `storeDeviceCertificate(cert, rootCa)` | DERバイナリ | void | サーバーから返却されたDevice Certificateを保存 |

CSR生成には、Android側ではBouncyCastle（`PKCS10CertificationRequestBuilder`）、iOS側ではASN.1を組み立てる軽量実装を使用する。いずれもネイティブモジュール内に閉じ込め、JS層には露出しない。

## 4.7 鍵ライフサイクル管理

### Root CA鍵

| 項目 | 方針 |
| --- | --- |
| 生成 | AWS KMSで一度だけ生成。KMS外への抽出不可 |
| バックアップ | KMSマルチリージョンキー機能でDRリージョンに複製 |
| ローテーション | 当面不要。実施する場合は新Root CAを追加し、旧Root CAも並行して信頼する移行期間を設ける |
| 失効 | Root CAの失効は行わない（行う場合はエコシステム全体に影響するため） |

### Device Certificate

| 項目 | 方針 |
| --- | --- |
| 発行 | アプリインストール時（アカウント不要） |
| 有効期限 | 90日。侵害された鍵の影響範囲を時間的に限定する |
| 更新 | 残り14日で自動更新。同一鍵ペアに対して新しい証明書を発行する（§4.4.2参照） |
| 再発行 | 端末にDevice Certificateが残っていない場合に新規発行。旧証明書で署名済みのコンテンツの検証には影響しない |
| 失効（CRL） | サーバーが管理するCRL（Certificate Revocation List）で即座に失効可能。不正利用が発覚した場合に使用する |

### CRL（Certificate Revocation List）

RootLensサーバーは失効済みDevice Certificateのシリアル番号リストを管理する。

```
GET /api/v1/crl
```

レスポンス:
```json
{
  "revoked_serials": ["<hex serial>", ...],
  "updated_at": "<ISO 8601>"
}
```

公開ページおよびTitle Protocolの検証パイプラインは、C2PA署名の検証時にこのCRLを参照し、失効済みDevice Certificateによる署名を拒否する。CRLには5分間のキャッシュを設定する。

**失効の影響：** Device Certificateを失効させた場合、そのDevice Certificateで署名された **すべての** コンテンツの検証が失敗するようになる。RFC 3161タイムスタンプの有無にかかわらず、CRLに含まれるシリアル番号の証明書は拒否される。これは意図的な設計であり、侵害された鍵による署名を確実に無効化するためである。

## 4.8 C2PA Trust Listとの関係

RootLensは独自のRoot CAを運用するため、C2PA公式Trust Listへの登録は初期リリース時点では行わない。Title Protocolの検証パイプラインがRootLens Root CAを信頼済みとして扱い、公開ページではクライアントサイド検証でTitle Protocolのオンチェーンデータを参照するため、C2PA Trust Listへの依存はない。

ただし、将来的にC2PA Conformance Programへの参加を検討する。登録により、Adobe Content Authenticity等の外部検証ツールでもRootLensで署名されたコンテンツが「信頼された発行者」として認識されるようになる。

| フェーズ | 方針 | 外部ツールでの表示 |
| --- | --- | --- |
| 初期リリース | 独自CAのみ | 「発行者を認識できません」 |
| 将来 | C2PA Conformance Program参加 | 「RootLens Inc. により署名」 |

独自CA運用中も、C2PA仕様に準拠した証明書プロファイル（ES256、id-kp-documentSigning EKU）を採用しているため、将来のTrust List登録に際して証明書構造の変更は不要である。

---

# 5. アカウント・認証

## 5.1 アカウントモデル

RootLensのアカウント管理はPrivyに委譲する。

- ユーザーはメール認証またはソーシャルログイン（Google、Apple等）でアカウントを作成・ログインする
- Privyが内部でSolanaウォレット（Ed25519鍵ペア）を自動生成・管理する
- ウォレットの秘密鍵はPrivyのインフラで安全に管理され、ユーザーがシードフレーズを管理する必要はない
- アカウント登録が必要となるのはコンテンツの「公開」時のみ。カメラ撮影と編集はログインなしで利用可能
- 機種変更・アプリ再インストール時は、Privyに同じ認証情報（メールアドレスまたはソーシャルアカウント）でログインすることで、同一アカウントとウォレットにアクセスできる

## 5.2 Privyウォレット（Solana）

- Privyがアカウント作成時に自動生成・管理する
- cNFTの帰属先（受け取りアドレス）となる
- 将来コンテンツが生み出す収益の受け口となる
- ユーザーはシードフレーズや秘密鍵を意識する必要がない
- 端末と公開鍵があれば、別のアプリからでもウォレット操作可能

## 5.3 通信認証

RootLensサーバーとの通信認証はPrivyのセッション管理に委譲する。

**認証フロー：**

1. ユーザーがPrivy経由でログインする（メール認証またはソーシャルログイン）
2. Privyがアクセストークンを発行する
3. アプリはPrivyのアクセストークンをAuthorizationヘッダーに載せてRootLensサーバーと通信する
4. RootLensサーバーはPrivyのSDKを使用してトークンを検証し、ユーザーを特定する

**認証不要な操作：**

- Device Certificate発行（CSR + Platform Attestation。アカウント登録前に実行される）
- ホワイトリストの取得

**認証が必要な操作（ログイン後）：**

- コンテンツの公開
- コンテンツの削除・非公開
- 設定変更
- R2ストレージへのアクセス

---

# 6. 公開パイプライン

ユーザーが編集画面で「公開」ボタンを押した後に実行される処理の全体像。公開ボタン押下後、未ログインの場合はPrivy経由のログインを先に完了させる。ログイン済みの場合、以下の2つの処理が**並列**で実行される。

## 6.1 パイプラインA：Title Protocol登録

> **前提：** 公開対象のコンテンツには、撮影時にTEE内の秘密鍵で付与されたC2PA署名が含まれている。この署名のCOSE `x5chain` ヘッダーには、Device CertificateおよびRoot CA証明書が埋め込まれている（「4.5.1 COSE署名構造」参照）。ネットワークが利用可能な状態で署名された場合、TSAタイムスタンプも `sigTst2` に含まれている。
> 

**実行主体を明示したフロー：**

| ステップ | 実行主体 | 処理内容 |
| --- | --- | --- |
| 1 | アプリ（Title Protocol SDK） | Solana上のTitle Protocol `GlobalConfig`アカウントを読み取り、利用可能なノード一覧を取得する |
| 2 | アプリ（Title Protocol SDK） | Title Protocol SDKの選択ロジックに従いノードを1つ選択する |
| 3 | アプリ（Title Protocol SDK） | C2PA署名済みコンテンツをE2EE（End-to-End Encryption）でノードに直接アップロードする |
| 4 | ノード（TEE内） | コンテンツを復号・検証する：C2PA来歴検証（Core）+ RootLensが要求するExtensionの実行（署名元検証およびpHash算出） |
| 5 | ノード | cNFTに紐づけるJSONデータを生成し、アプリに返却する |
| 6 | アプリ（Title Protocol SDK） | 検証結果を確認し、問題なければ当該JSONデータをArweaveに保存する |
| 7 | アプリ（Title Protocol SDK） | Arweaveのリンクをノードに送り返す |
| 8 | アプリ | gas代行ミント用のウォレット（RootLens代行ウォレット）を指定する |
| 9 | ノード | cNFTをミントし、ユーザーのPrivyウォレット（公開鍵）に帰属させる |

上記はTitle Protocol SDKで一括実行される。

### Title Protocol登録時のExtension指定

Title Protocol登録時、RootLensはコンテンツの種別に応じて以下のExtensionによる検証をノードに要求する。

| Extension ID | 対象 | 検証内容 | 役割 |
| --- | --- | --- | --- |
| `hardware-google` 等 | 該当するコンテンツ | ハードウェア署名の検証 | 署名元の信頼レベル判定 |
| `rootlens-app` | 該当するコンテンツ | RootLens署名の検証 | 署名元の信頼レベル判定 |
| `phash-image` | 画像コンテンツ | DCT 64ビット知覚的ハッシュの算出 | 表示コンテンツとの同一性検証 |
| `phash-video` | 動画コンテンツ | フレームサンプリングによる知覚的ハッシュ列の算出 | 表示コンテンツとの同一性検証 |

署名元検証のExtension（`hardware-*`、`rootlens-app`）は「コンテンツが本物であるか」の判定に使用される。pHash Extension（`phash-image`、`phash-video`）は「公開ページに表示されているコンテンツが、登録されたコンテンツと同一であるか」の判定に使用される。両者は異なる信頼の鎖を担い、組み合わさることでエンドツーエンドのトラストレス検証が成立する。

pHash Extensionの技術仕様は「6.3 pHash Extension仕様」を参照。

### cNFT構造

1コンテンツあたり、Core cNFT 1つ + Extension cNFT 1つ以上が発行される：

| cNFT | 役割 | 対応するTitle Protocolの仕組み |
| --- | --- | --- |
| Core cNFT | C2PA来歴検証結果・来歴グラフの記録 | Core（`core-c2pa`） |
| Extension cNFT | コンテンツが何によって本物証明を得ているか、およびPDQ等の検証結果の記録 | Extension（`cert-rootlens`、`cert-google`、`image-pdq`、`video-vpdq`等） |

複数コンテンツを一括公開した場合、コンテンツごとにCore + Extensionの組が発行される。

## 6.2 パイプラインB：データ保存

### R2ストレージ（バイナリデータ）

R2ストレージは用途に応じて2つのバケットに分離する。

**非公開バケット（Privy認証必須、アカウント所有者のみアクセス可能）：**

1. オリジナルの生データ（画像・動画ファイル）

**公開バケット（公開ページからの配信用）：**

1. 編集後のデータ（公開用コンテンツ画像・動画ファイル）
2. OGP画像（「Shot on RootLens」帯付き。アプリ側で生成）

非公開バケットに生データを保存する目的は、あとから公開データを再編集してプロトコルに再登録する際、ユーザーが手元にオリジナルコンテンツがなくても編集できるようにするためである。サーバーが署名付きURLを発行し、アカウント所有者のみがアクセスできるよう制御する

公開バケットは公開ページおよびOGPからの参照に使用される。

R2にはバイナリデータのみを保存する。構造化されたメタデータ（編集操作、ページ管理等）はSupabaseに保存する。

### Supabase（構造化データ）

公開処理と同時に、以下のデータをSupabaseに保存する。

- ページレコード（pageId、shortId、公開状態、Title Protocol上の識別子等）
- コンテンツとR2オブジェクトキーの紐づけ
- 編集操作データ（JSON。クロップ座標、トリミング範囲、マスク領域等）

テーブル設計の詳細は「10.4 データベース設計」を参照。

## 6.3 Extension仕様

RootLensが使用するTitle Protocol Extensionの技術仕様を以下に定める。Extensionは3カテゴリに分類され、アプリがコンテンツの特性に基づいて各カテゴリから適切なExtensionを選択し、`processor_ids` としてTitle Protocolに送信する。

### Extensionカテゴリ

| カテゴリ | 選択基準 | Extension ID |
| --- | --- | --- |
| Core | 常に含める | `core-c2pa` |
| 証明書検証 | C2PA署名者（signer_org）から判定 | `cert-rootlens`, `cert-google`, `cert-sony`, `cert-leica` |
| 知覚ハッシュ | メディア種別から判定 | `image-pdq`（画像）, `video-vpdq`（動画） |

アプリは公開前にC2PAマニフェストを読み取り（`readManifest()`）、`signer_org` をガバナンスAPIの `extensions.certificate` 定義とマッチングして適用可能な証明書検証Extensionを判定する。メディア種別に応じて知覚ハッシュExtensionを選択する。

### 6.3.1 `cert-rootlens` / `cert-google` 等（証明書検証）

C2PAアクティブマニフェストの署名証明書チェーンを、特定のRoot CAに対して暗号的に検証するExtension。

**TEE内処理:**
1. コンテンツからJUMBFを抽出
2. アクティブマニフェストのCOSE_Sign1からx5chain（DER証明書チェーン）を抽出
3. 証明書チェーンを暗号的に検証（各証明書の署名を親の公開鍵で検証）
4. チェーン末端がWASMに埋め込まれたRoot CA公開鍵（SPKI）と一致するか確認

**出力:** `{"verified": true/false, "chain": [...], "root_ca": "RootLens Root CA"}`

各cert WASMモジュールにはそれぞれのRoot CA公開鍵が埋め込まれており、WASMバイナリのSHA-256ハッシュがGlobalConfigに登録されている。

### 6.3.2 `image-pdq`（画像用知覚ハッシュ）

画像コンテンツの256ビット知覚ハッシュをPDQアルゴリズム（Meta ThreatExchange互換）で算出するExtension。

**入力：** C2PA検証済みの画像バイナリ（JPEG / PNG / WebP / TIFF / HEIC / カメラRAW等）

**TEE内処理ロジック：**

1. 画像をデコードし、Jaroszフィルタで64×64ピクセルにダウンサンプリングする
2. BT.601係数（Y = 0.299R + 0.587G + 0.114B）でグレースケールに変換する
3. 64×64の2D DCTを適用し、16×16の低周波係数（DC成分を除く）を取り出す
4. 256係数のTorben中央値を算出し、各係数が中央値超なら1、以下なら0として256ビットハッシュを生成する
5. 勾配エネルギーから品質メトリクス（0-100）を計算する

**出力：**

```json
{
  "pdqhash": "a4c3f2e1b5d6c7a8...(64文字hex, 256bit)",
  "quality": 85,
  "algorithm": "pdq",
  "bits": 256
}
```

**互換性:** Meta ThreatExchange PDQリファレンス実装（C++ BSD）と同一のDCT行列、Torben中央値、品質メトリクス、ビットレイアウト。`pdqhash` Pythonパッケージと同一のhex出力バイトオーダー。

### 6.3.3 `video-vpdq`（動画用知覚ハッシュ）

動画コンテンツのフレーム単位PDQハッシュ列を算出するExtension。

**入力：** C2PA検証済みの動画バイナリ（MOV / MP4 / WebM / AVI）

**TEE内処理ロジック：**

1. 1fpsでフレームをサンプリングする
2. 各フレームに対してimage-pdqと同一のPDQ 256ビットハッシュを計算する
3. 品質50未満のフレームをフィルタする
4. ハッシュが同一の連続フレームを重複排除する

**出力：**

```json
{
  "frames": [
    { "pdqhash": "...", "quality": 85, "timestamp": 0.0 },
    { "pdqhash": "...", "quality": 78, "timestamp": 1.0 }
  ],
  "frame_count": 15,
  "algorithm": "vpdq",
  "sampling_fps": 1
}
```

### 6.3.4 PDQの特性と選定理由

PDQ（Perceptual hash by Meta）は256ビットの知覚ハッシュであり、以下の特性からRootLensのコンテンツ同一性検証に採用した。

**解像度ロバスト性：** JaroszフィルタによるアンチエイリアスダウンサンプリングとDCTの低周波成分のみの使用により、解像度の変化に対してロバストである。

**ブラウザ内での再計算可能性：** DCT計算にはGlobalConfigの `trusted_wasm_modules` から動的に取得したWASMバイナリ（SHA-256照合済み、TEEと同一バイナリ）を使用する。ダウンサンプリングにはTitle Protocolの `jarosz.rs` と同一のRustソースからビルドした `jarosz.wasm` をブラウザで実行し、TEEとのbit-identical一致を保証する。

**十分な識別力：** 256ビットのハッシュ空間はRootLensの事業規模に対して十分な衝突耐性を持つ。Metaの大規模コンテンツモデレーション（数十億規模）で実績がある。

**業界標準との互換性：** Meta ThreatExchange PDQリファレンス実装と互換のため、外部ツールとの相互運用が可能。

**照合に使用する閾値：** 公開ページでのPDQ照合では、256ビット空間のハミング距離を使用する。Metaの推奨閾値31を初期値とする。同一コンテンツの再エンコード差のみを許容する用途のため、将来より厳しい閾値に調整する可能性がある。

## 6.4 公開ページ生成・リンク発行

パイプラインA・Bの完了後：

1. 公開ページを生成（rootlens.io上）
2. 公開ページURLをユーザーに表示

## 6.5 再登録

- 一度公開したコンテンツを再編集して再登録することが可能
- 再登録時、元のcNFTはバーンされず両方残る
- 公開ページは新しいcNFTに紐づくデータを指す

---

# 7. 公開ページ

## 7.1 URL構造

正規URLと共有用短縮URLの2系統を持つ。

**正規URL（内部的に保持）：**

| ページ | URL | 内容 |
| --- | --- | --- |
| 公開者ページ | `rootlens.io/{Privyウォレットアドレス}` | そのユーザーに紐づく公開コンテンツ一覧 |
| コンテンツページ | `rootlens.io/{Privyウォレットアドレス}/{pageId}` | 個別の公開ページ（1枚でも複数枚でも同じ粒度） |

**共有用短縮URL（SNS共有時に使用）：**

| ページ | URL | 内容 |
| --- | --- | --- |
| 公開者ページ | `rootlens.io/@{username}` | ユーザー名設定済みの場合に利用可能 |
| コンテンツページ | `rootlens.io/p/{shortId}` | 公開時にサーバーが生成するランダムな短いID（7〜11文字程度） |
- `pageId` はページレベルのIDであり、公開時にサーバーが生成する。1枚の画像でも、複数画像をまとめたページでも、同一粒度のIDが振られる
- `shortId` は公開時にサーバーがランダムに生成し、DBのユニーク制約で衝突を防ぐ
- 短縮URLへのアクセスは正規URLと同じページを直接表示する（リダイレクトではない）
- アプリ内でのリンクコピー・SNS共有時には短縮URLを使用する
- 画像Aを単独で公開した場合と、画像A・B・Cをまとめて公開した場合は、それぞれ独立したページIDを持つ
- ページIDからRootLensサーバーに問い合わせることで、対応するコンテンツレベルのTitle Protocol上の識別子を取得できる

## 7.2 コンテンツページの表示内容

- コンテンツ画像（トップに大きく表示）
- 撮影日時
- 端末情報
- 本物証明のステータス（「Shot on RootLens」「Shot on Google Pixel」等）
- コンテンツ同一性の検証ステータス（ブラウザ内でのpHash照合結果。一般ユーザー向けには技術的詳細を見せず、本物証明のステータス表示に統合する形で「検証済み」であることを示す）
- RootLens上での編集内容（何をしたかの履歴）
- Title Protocol上の検証レコードへの参照（7.4で詳述）

実際の表示内容はTitle Protocolの登録データに基づいて調整する。

## 7.3 OGP

- コンテンツ画像に「Shot on RootLens」（またはデバイス名）の帯を付けた画像をOGPとして使用
- SNS（X等）のタイムラインでリンクを投稿した際にサムネイルとして表示される
- OGP画像はアプリ側で生成し、R2の公開バケットに保存してmetaタグから参照する

## 7.4 クライアントサイド検証アーキテクチャ

### 設計原則

公開ページにおける本物証明の表示は、RootLensサーバーから取得したデータに基づいてはならない。公開ページのJavaScriptは、Solana RPCおよびArweaveに直接問い合わせてオンチェーン・オフチェーンデータを取得し、TEE署名の検証およびpHash照合までをブラウザ内で完結させる。

この設計により、公開ページの閲覧者がRootLensを信頼する必要がなくなる。RootLensが嘘のデータを返す余地が構造的に存在しないだけでなく、RootLensが表示画像とオンチェーンレコードの対応を偽ることもpHash照合によって検出される。

### 信頼モデル

一般ユーザーにとっては、RootLensブランドへの信頼が公開ページを信じる実質的な根拠となる。しかし、疑う人は誰でもブラウザの開発者ツールを開くだけで、公開ページがRootLensサーバーではなくSolana RPCとArweaveから直接データを取得していること、および表示画像のpHashがオンチェーンの値と一致していることを確認できる。

全員が検証する必要はない。「検証できる人がいる」という構造が、RootLensを正直に保つ圧力として機能する。これはSSL/TLSにおけるCertificate Transparency（CTログ）と同じ構造である。一般ユーザーはCTログの存在を知らないが、セキュリティ研究者がCTログを監視しているという事実が認証局の信頼を支えている。

### 検証フロー

公開ページは以下のステップをブラウザ内で実行する。

1. Solana RPCに直接接続し、content_hashに対応するcNFTを取得する
2. cNFTのcollectionアドレスが、Global Configの公式コレクションと一致することを確認する
3. cNFTのURIからArweave上のオフチェーンデータを直接取得する
4. オフチェーンデータに含まれるTEE署名（Ed25519）をブラウザ内で検証する
5. オフチェーンデータからpHash Extension（`phash-image` または `phash-video`）の結果を取得する
6. 表示画像（または動画のサンプリングフレーム）からpHashをブラウザ内で再計算する
7. 再計算したpHashとオンチェーンのpHashのハミング距離を算出し、閾値以内であることを確認する
8. 検証に成功したデータに基づいて、本物証明のステータスを表示する

上記のいずれのステップにも、RootLensサーバーへのリクエストは含まれない。

ステップ1〜4は「オンチェーンの検証結果が正当か」を確認する鎖であり、ステップ5〜7は「表示されているコンテンツがそのオンチェーンレコードに対応するコンテンツと同一か」を確認する鎖である。この2つの鎖が両方閉じることで、「この画像は本物のカメラで撮影されたコンテンツである」というエンドツーエンドのトラストレス検証が成立する。

### RootLensサーバーの役割の限定

公開ページにおいてRootLensサーバーが担うのは以下のみである。

| RootLensサーバーが担うこと | 担わないこと |
| --- | --- |
| 公開ページのHTML/JS/CSSの配信 | 検証データの提供 |
| OGP画像の配信 | cNFT情報の中継 |
| shortIdから正規URLへのルーティング | オフチェーンデータの中継 |
| 表示用コンテンツ画像のR2からの配信 | TEE署名の検証結果の提供 |
|  | pHash照合結果の提供 |

RootLensサーバーが停止しても、オンチェーン・オフチェーンのデータは永続しており、別のフロントエンドから同じ検証を再現できる。

**公開ページJS自体の完全性について：** 公開ページのHTML/JS/CSSはRootLensサーバーから配信されるため、RootLensがJSを改ざんすれば偽の検証結果を表示できる余地がある。この信頼の境界に対しては、公開ページにcNFT asset IDをそのまま表示することで対処する。閲覧者はこのIDを使い、SolanaエクスプローラーやArweaveゲートウェイに直接アクセスして、RootLensのUIを一切経由せずに検証結果を独立に確認できる。RootLensが偽のIDを表示した場合、そのIDでオンチェーンを参照すれば内容の不一致または不存在が即座に判明するため、改ざんは実質的に検出可能である。さらに、pHashがオンチェーンに記録されているため、閲覧者は表示画像のpHashを自分で計算し、オンチェーンの値と突き合わせることで、RootLensが画像とオンチェーンレコードの対応を偽っていないことも独立に確認できる。

### 開発者向け検証トレーサビリティ

公開ページは、検証プロセスの全ステップをブラウザの開発者ツールで完全にトレース可能にする。

**Networkタブ：** 開発者ツールのNetworkタブを開けば、公開ページが以下のリクエストを発行していることが確認できる。

- Solana RPCエンドポイント（`api.mainnet-beta.solana.com` 等）への `getAsset` リクエスト
- Arweave（`arweave.net/xxxx`）へのオフチェーンデータ取得リクエスト

RootLensサーバーへの検証データ取得リクエストが存在しないことが、目視で確認できる。

**Consoleタブ：** 検証の各ステップを構造化ログとして出力する。

```
[RootLens Verification]
Step 1: Fetching cNFT from Solana...
  → RPC: https://api.mainnet-beta.solana.com
  → Asset ID: 7xKX...
  → Collection: verified ✓ (matches GlobalConfig.core_collection_mint)

Step 2: Fetching off-chain data from Arweave...
  → URI: ar://abc123...
  → TEE signature: valid ✓ (Ed25519, pubkey: 4nPz...)

Step 3: Verifying content identity via pHash...
  → On-chain pHash: a4c3f2e1b5d6c7a8 (from phash-image extension)
  → Computed pHash: a4c3f2e1b5d6c7a8 (from displayed image)
  → Hamming distance: 0 ✓ (threshold: 5)

Step 4: Content hash matches on-chain record ✓

All verification performed client-side. No RootLens server involved.
```

このログは開発者やセキュリティ研究者が公開ページの信頼性を独立に検証するためのものであり、一般ユーザー向けUIには表示しない。

**意図：** 技術者が検証して「RootLensの公開ページ、開発者ツールで見たらSolanaに直接問い合わせてた。しかも表示画像のpHashもオンチェーンの値と一致してた」とSNSやブログで発信すること自体が、一般ユーザーの信頼の根拠となる。この構造を意図的に設計する。

## 7.5 データの削除・非公開

- ユーザーは公開ページを非公開にする、または削除することが可能
- R2上のデータは削除される
- オンチェーンのcNFTレコードは残るが、オンチェーンデータから元のコンテンツを類推することはできない

なお、オンチェーンに永続化されるのはcontent_hash（C2PAマニフェスト署名のSHA-256ハッシュ）、pHash、来歴グラフ構造、ウォレットアドレス等のメタデータのみであり、コンテンツの生データ（画像・動画ファイル本体）はオンチェーンにもオフチェーンストレージにも保存されない。そのため、R2上のデータを削除すれば、公開ページからコンテンツを閲覧する手段はなくなる。

なお、pHashはコンテンツの知覚的な指紋であり、pHashから元の画像を復元することはできない。削除後にオンチェーンにpHashが残存しても、プライバシー上の問題は生じない。

---

# 8. ホワイトリスト管理

## 8.1 概要

RootLensは、信頼するTitle Protocol Extension IDのリストをホワイトリストとして管理する。ホワイトリストに含まれるExtensionの検証を通過したコンテンツを「本物」として認める。

## 8.2 ホワイトリストの内容

ホワイトリストの各エントリは、Title ProtocolのExtension IDと、アプリ上の表示名のペアである。

| extension_id | 表示名 | 説明 |
| --- | --- | --- |
| `hardware-google` | Google Pixel | Titan M2チップ等によるハードウェア署名 |
| `hardware-nikon` | Nikon | Nikonカメラのハードウェア署名 |
| `hardware-canon` | Canon | Canonカメラのハードウェア署名 |
| `hardware-sony` | Sony | Sonyカメラのハードウェア署名 |
| `rootlens-app` | RootLens | RootLensアプリによる署名 |

ホワイトリストは署名元の信頼レベルを判定するExtensionのみを管理する。pHash Extension（`phash-image`、`phash-video`）はコンテンツ同一性検証の用途であり、ホワイトリストとは独立に常時要求される（「6.1 Title Protocol登録時のExtension指定」参照）。

ホワイトリストの各Extension IDが表す検証内容は、Title ProtocolのTEE内で実行されるExtensionの検証ロジックに対応する。RootLensアプリが端末ギャラリーでローカルC2PA検証を行う際は、C2PA署名チェーンのRoot CA証明書を以下の基準で照合する。

- ハードウェア署名（`hardware-google`、`hardware-nikon` 等）: 各メーカーのC2PA Trust Anchor証明書と照合
- RootLensアプリ署名（`rootlens-app`）: RootLens Root CA証明書と照合

## 8.3 取得方法

RootLensサーバーが提供するエンドポイントから取得する。

```
GET /api/whitelist

Response:
[
  { "extension_id": "hardware-google", "label": "Google Pixel" },
  { "extension_id": "hardware-nikon", "label": "Nikon" },
  { "extension_id": "rootlens-app", "label": "RootLens" },
  ...
]
```

- アプリ起動時にサーバーから最新のホワイトリストを取得する
- 取得したリストはローカルにキャッシュし、オフライン時はキャッシュを使用する
- 新しいC2PA対応デバイスの追加がアプリアップデートなしに反映可能

## 8.4 使用箇所

| 場面 | 使い方 |
| --- | --- |
| 端末ギャラリーのC2PAスキャン | ローカルC2PA検証で署名元を判別し、ホワイトリストの表示名でバッジを表示。ホワイトリスト外はグレーアウト |
| 公開パイプライン | Title Protocol SDKに `processor_ids` としてホワイトリストの `extension_id` リスト + pHash Extension（`phash-image` または `phash-video`）を渡す |
| 公開ページの表示 | Extension cNFTの `extension_id` とホワイトリストの `label` を照合して「Shot on Google Pixel」等を表示。pHash Extension cNFTの結果はコンテンツ同一性検証に使用 |

---

# 9. 課金

## 9.1 モデル

App Store / Google Playのサブスクリプションとして実装する。

## 9.2 プラン（暫定）

| プラン | 月額 | 月間登録回数 | ストレージ上限 |
| --- | --- | --- | --- |
| Free | 無料 | 10回 | 2GB |
| Standard | $5 | 100回 | 100GB |
| 上位プラン | 未定 | 未定 | 未定 |

具体的な数値は今後調整する。

## 9.3 gas代

Title Protocol登録時のSolanaトランザクションgas代はRootLensが代行負担する。

---

# 10. インフラ構成

## 10.1 コンポーネント一覧

| コンポーネント | 役割 | 備考 |
| --- | --- | --- |
| RootLensモバイルアプリ | iOS / Android | C2PA署名、編集、公開UIを提供 |
| RootLensサーバー | 認証局（CA）、ページID管理、ホワイトリスト配信、OGPホスティング | Next.js API Routes（Node.jsランタイム）。CSRによるDevice Certificate発行を含む。X.509操作には `@peculiar/x509`、KMS署名には `@aws-sdk/client-kms` を使用。アカウント管理・認証はPrivyに委譲 |
| Privy | アカウント管理、認証、Solanaウォレット管理 | メール認証・ソーシャルログイン・ウォレット生成を担う |
| Cloudflare R2 | コンテンツストレージ | 非公開バケット（生データ）と公開バケット（公開用コンテンツ、OGP画像）に分離。非公開バケットはPrivy認証によるアクセス制御。構造化データ（編集操作等）はSupabaseに保存し、R2にはバイナリデータのみを保存する |
| AWS KMS | RootLens Root CA秘密鍵の管理 | ECC_NIST_P256鍵。Device Certificate署名に使用。FIPS 140-2 Level 2 |
| Title Protocolノード | コンテンツ検証（TEE内） | GlobalConfigから動的に選択。初期は少数だが分散的に増やす方針。C2PA検証に加え、pHash算出等のExtensionをTEE内で実行する |
| Solana | cNFT記録 | メインネット |
| Arweave | cNFT紐づきメタデータの永続保存 | C2PA検証結果、pHash等のExtension結果を含む |
| rootlens.io | 公開ページのホスティング | クライアントサイド検証JS（Solana RPC直接接続、pHash再計算・照合）を配信 |
| Supabase (PostgreSQL) | リレーショナルデータの管理 | ページ管理、編集操作データ、ユーザー名、サブスクリプション状態。Supabase Authは使用しない（認証はPrivyに委譲） |

## 10.2 オフライン対応

RootLensは、撮影・編集をオフラインで完結させ、公開をオンラインで行う設計である。ただし、「オフラインで撮影から公開まで完結できる」ことを設計目標とはしていない。これは、撮影直後にオンチェーン登録を強制するアプリとは異なり、ユーザーが自分のタイミングで公開を選択できることを意味する。

| 操作 | オフライン | オンライン |
| --- | --- | --- |
| 撮影時のC2PA署名 | ✓（TEE内で実行） | ✓ |
| 撮影時のTSAタイムスタンプ取得 | ✗ | ✓（署名直後に取得） |
| 編集操作のC2PA署名 | ✓（TEE内で実行） | ✓ |
| 編集時のTSAタイムスタンプ取得 | ✗ | ✓（署名直後に取得） |
| 公開（Title Protocol登録、R2アップロード） | ✗ | ✓（必須） |

TSAタイムスタンプが付与されていないコンテンツについては、Title Protocol側がブロックチェーンの登録タイムスタンプを時刻根拠とする。

## 10.3 動画サイズ制限

- Title Protocolノードの処理能力に依存するため、明確な上限値が存在する
- 目安としてGBを超えるコンテンツでノード切り替え等の対応が必要になる
- 具体値はノードのスペックにより変動するため、本仕様書では固定値を定めない

## 10.4 データベース設計

### 技術選定

リレーショナルデータの管理にはSupabaseを使用する。Supabase AuthおよびSupabase Storageは使用せず、PostgreSQLデータベースとしてのみ利用する。認証はPrivy、ファイルストレージはR2がそれぞれ担う。

### テーブル一覧

### `users`

ユーザーアカウントを管理する。現時点ではSolanaウォレットアドレス（Privy生成）を唯一の外部識別子とする。Privy統合が進んだ段階で `privy_user_id` の追加を再検討する。

| カラム | 型 | 制約 | 説明 |
| --- | --- | --- | --- |
| id | uuid | PK, default gen_random_uuid() | 内部ID |
| address | text | UNIQUE, NOT NULL | Solanaウォレットアドレス（Privy生成） |
| username | text | UNIQUE | 公開ページの表示名。`rootlens.io/@{username}` に使用。NULL許容（未設定の場合） |
| display_name | text |  | 表示名 |
| bio | text |  | プロフィール文 |
| avatar_url | text |  | アバター画像URL |
| device_name | text |  | 公開ページに表示するデバイス名 |
| created_at | timestamptz | NOT NULL, default now() |  |
| updated_at | timestamptz | NOT NULL, default now() |  |

### `pages`

公開ページ単位のレコード。1回の公開操作につき1レコード。

| カラム | 型 | 制約 | 説明 |
| --- | --- | --- | --- |
| id | uuid | PK, default gen_random_uuid() | pageId |
| user_id | uuid | FK → users.id | クリエイターページ実装後、既存データの埋め戻しを経てNOT NULL制約を追加する |
| short_id | text | UNIQUE, NOT NULL | 共有用短縮ID（7〜11文字） |
| status | text | NOT NULL, default ‘published’ | `published` / `hidden` / `deleted` |
| published_at | timestamptz | NOT NULL |  |
| created_at | timestamptz | NOT NULL, default now() |  |
| updated_at | timestamptz | NOT NULL, default now() |  |

### `contents`

ページに紐づく個別コンテンツ。1ページに1つ以上。

| カラム | 型 | 制約 | 説明 |
| --- | --- | --- | --- |
| id | uuid | PK, default gen_random_uuid() |  |
| page_id | uuid | FK → pages.id, NOT NULL |  |
| content_type | text | NOT NULL | `photo` / `video` |
| thumbnail_url | text |  | R2公開バケットのサムネイル完全URL |
| ogp_image_url | text |  | R2公開バケットのOGP画像完全URL |
| media_url | text |  | R2公開バケットのメディア（動画等）完全URL |
| title_protocol_asset_id | text |  | Title Protocol上のcNFT Asset ID（Core cNFT） |
| content_hash | text |  | C2PAマニフェスト署名のSHA-256ハッシュ |
| device_label | text |  | 署名元の表示名（「Google Pixel」「RootLens」等。ホワイトリストのlabelに対応） |
| shot_at | timestamptz |  | 撮影日時（C2PAマニフェストから取得） |
| created_at | timestamptz | NOT NULL, default now() |  |

> **設計判断:** アプリがpresigned URL経由でR2に直接アップロードし、公開URLをそのまま保存するフローが確立したため、R2オブジェクトキー（`r2_original_key` / `r2_public_key` / `r2_ogp_key`）ではなく完全URL（`thumbnail_url` / `ogp_image_url` / `media_url`）を格納する。

> **将来追加予定のカラム:**
> - `user_id` (FK → users.id) — クリエイターページ実装時に追加し、既存データの埋め戻し後にNOT NULL制約を付与する
> - `edit_operations` (jsonb) — 公開ページでの編集履歴表示実装時に追加

`edit_operations` を追加する場合のJSON構造：

```json
{
  "actions": [
    {
      "type": "c2pa.cropped",
      "params": { "x": 0, "y": 100, "width": 1920, "height": 800 }
    },
    {
      "type": "c2pa.trimmed",
      "params": { "start_ms": 1500, "end_ms": 8000 }
    }
  ]
}
```

### `subscriptions`

サブスクリプション状態と月間使用量の管理。

| カラム | 型 | 制約 | 説明 |
| --- | --- | --- | --- |
| id | uuid | PK, default gen_random_uuid() |  |
| user_id | uuid | FK → users.id, UNIQUE, NOT NULL |  |
| plan | text | NOT NULL, default ‘free’ | `free` / `standard` |
| store_product_id | text |  | App Store / Google PlayのプロダクトID |
| store_transaction_id | text |  | ストアのトランザクションID |
| expires_at | timestamptz |  | サブスクリプション有効期限。freeの場合はNULL |
| current_period_start | timestamptz | NOT NULL | 現在の集計期間の開始日 |
| publications_this_period | integer | NOT NULL, default 0 | 現在の期間内の公開回数 |
| created_at | timestamptz | NOT NULL, default now() |  |
| updated_at | timestamptz | NOT NULL, default now() |  |

公開パイプライン実行時に `publications_this_period` をプランの上限と照合し、超過している場合は公開を拒否する。`current_period_start` はサブスクリプション更新時にリセットされる。

### インデックス

| テーブル | カラム | 用途 | 状態 |
| --- | --- | --- | --- |
| pages | short_id | 短縮URLからのルーティング | 実装済み |
| pages | user_id | 公開者ページでの一覧取得 | 実装済み（将来 `(user_id, status)` 複合に拡張） |
| contents | page_id | ページ内コンテンツの取得 | 実装済み |
| contents | content_hash | Title Protocolの識別子との照合 | 実装済み |
| users | address | 正規URL（`/{walletAddress}`）からのルーティング | 実装済み |
| users | username | 短縮URL（`/@{username}`）からのルーティング | usernameカラム追加時に作成 |

### Row Level Security

Supabase AuthではなくPrivy認証を使用する。書き込み操作はRootLensサーバー（Next.js API Routes）がservice_roleキーで実行し、RLSをバイパスする。

公開ページのサーバーコンポーネント（Next.js RSC）から公開状態のページを取得する際は、Supabase anon keyによる直接読み取りを使用する。RLSポリシーにより `status = 'published'` のページのみが読み取り可能。これにより、公開ページの表示にAPI Routesを経由せず、サーバーコンポーネントからの効率的なデータ取得を実現する。

RLSポリシー:
- `pages`: anon は `status = 'published'` のレコードのみSELECT可能
- `contents`: anon は公開済みページに紐づくレコードのみSELECT可能
- `users`: anon はSELECT可能（プロフィール情報は公開）
- INSERT/UPDATE/DELETE: service_role のみ

---

# 11. プラットフォーム

- iOS、Androidの両方を初期リリース対象とする
- Apple Developer Programに「組織」として登録する（ウォレット関連機能のApp Store審査対策）

---

# 12. 事業目標（本提案期間）

## 12.1 RootLens

| 指標 | 目標値 |
| --- | --- |
| 月間アクティブ投稿者数 | 10,000人 |
| 月間コンテンツ登録数 | 100,000枚（10,000人 × 10枚） |
| 公開ページの月間閲覧者数 | 1,000,000人（100,000枚 × 10人/枚） |

## 12.2 Title Protocol

| 指標 | 目標値 |
| --- | --- |
| ソースコード | オープンソースとして公開 |
| チェーン | Solanaメインネット上で稼働 |
| 月間コンテンツ登録数 | 100,000枚 |
| GitHubスター数 | 50個 |
| 海外開発者によるノード構築 | 1つ以上 |

---

# 付録A：Title Protocol概要

本仕様書はRootLensのアプリケーション仕様を定めるものだが、Title Protocolの概要を付録として記載する。

## A.1 Title Protocolとは

あらゆるC2PA付きコンテンツに対し、コンテンツの客観的な情報についての検証を行い、その結果を改ざん不可能な形で記録するインフラストラクチャ。誰でも検証結果を閲覧・検索でき、特定の第三者への信頼を必要としない。

## A.2 トラストレス性の実現

| レイヤー | 保護対象 | 技術 |
| --- | --- | --- |
| 入口（検証行為） | C2PA署名チェーンの検証 | TEE（Trusted Execution Environment） |
| 出口（記録） | 検証結果の永続化 | Solanaブロックチェーン + Arweave |

## A.3 ノード

- 検証を実行するサーバー。ソースコードは全て公開
- 誰でもノードを立てて運用可能
- Solana上のGlobalConfigアカウントに登録されたノードがクライアントから利用可能
- プロトコルがどのノードを信用するか等の共通情報はDAO（分散型自律組織）により管理される

## A.4 Extension機構

Title Protocolの検証パイプラインは、Core（C2PA来歴検証）に加えて、任意の検証ロジックをExtensionとして追加できる設計になっている。Extensionの検証ロジックはノードのTEE内で実行されるため、検証結果のトラストレス性はCoreと同等に保証される。

RootLensは以下のExtensionを使用する。

- **署名元検証Extension**（`hardware-google`、`rootlens-app` 等）：コンテンツの署名元を特定し、信頼レベルを判定する
- **pHash Extension**（`phash-image`、`phash-video`）：コンテンツの知覚的ハッシュを算出し、閲覧者が表示コンテンツとの同一性をブラウザ内で検証できるようにする

Extension機構は上記に限定されず、将来的にAI特徴量、NSFW判定、OCRテキスト抽出等、任意の検証結果を追加できる。

## A.5 将来のユースケース（RootLensスコープ外）

- 「現実世界の写真」をAI学習用に販売するマーケットプレイス
- 動画の素材として使用された写真・音楽の権利者への自動収益配分
- 無断転載コンテンツの権利者特定と収益還元
- x402プロトコルを通じたAIエージェントによるコンテンツの自律購入