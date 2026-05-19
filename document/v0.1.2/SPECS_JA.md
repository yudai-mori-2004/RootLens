## 0. この文書について

この仕様書は、RootLens の設計と動作を、初めてこのプロジェクトに触れる開発者が上から順に読んで理解できるように書かれている。

---

## 1. RootLens とは何か

RootLens は、家事動作のエゴセントリック動画データを収集し、AI 企業にライセンス付きで販売するプラットフォームである。

供給側のユーザーは、スマートフォンのカメラで自分の両手が映る視点（一人称視点）から家事の動画を撮影する。撮影された動画は、VLM によるリアルタイム検証とスコアリングを経て、Title Protocol（以下 TP）に登録され、ユーザーは Root NFT（cNFT）を受け取る。ユーザーは Root NFT の delegate を RootLens に設定する（ステーキング）。RootLens は delegate として AI 企業との License NFT 発行に co-sign し、販売収益はスマートコントラクトを通じて撮影者に自動で還元される。

### 1.1 なぜこれに価値があるのか

Physical AI、World Model、Embodied AI といった領域では、実世界の人間の手の動作を一人称視点で捉えたデータへの需要が急速に拡大している。Apple の EgoDex のようなデータセットが示すように、両手の関節情報を伴うエゴセントリック動画は、ロボットの模倣学習や動作理解モデルの訓練に不可欠な素材である。

一方で、EU AI Act と EU 著作権指令の TDM オプトアウト条項により、権利関係が不明確なデータで学習したモデルは EU 市場で規制リスクを負う。RootLens は、撮影の真正性が暗号学的に検証され、ライセンスがオンチェーンで管理されたデータを供給することで、この両面の需要に応える。

ブロックチェーンを使う理由は、RootLens 自身にもライセンス記録の隠蔽・捏造ができない構造を作るためである。License NFT の発行数、保有者、収益の流れはすべてオンチェーンで公開されており、第三者が独立に検証できる。AI 企業は監査時に「このデータを使う権利がある」ことを License NFT で証明できる。

収益分配比率はオンチェーン Config (`staker_basis_points` / `delegate_basis_points`) に記録され、スマートコントラクトにより自動執行される。比率は `update_config` 命令で admin が更新可能だが、 操作はすべてオンチェーンで公開・検証可能であり、 過去発行された License NFT の発行時点の比率は tx ログから遡及確認できる。

### 1.2 関係者

- **供給者（ステーカー）**：家事を撮影してアップロードし、Root NFT の delegate を RootLens に設定する個人ユーザー。KYC を済ませている。データの著作権を保持し続ける。
- **RootLens（運営）**：モバイルアプリとサーバーを提供し、delegate として License NFT の発行に co-sign する。AI 企業との取引を仲介し、販売収益をステーカーに還元する。
- **AI 企業（需要者）**：RootLens を通じて License NFT と処理済みデータを購入する。

### 1.3 外部依存

- **Title Protocol**：C2PA 検証と Root NFT の発行を行う。
- **Solana**：Root NFT（cNFT）、License NFT（cNFT）、収益分配の台帳。
- **Privy**：ユーザーアカウントと Solana ウォレットの管理。
- **KYC サービス**：第三者 KYC 事業者に委託する。

---

## 2. データ収集フロー

この章では、供給者が家事を撮影し、Root NFT を受け取るまでの流れを扱う。

### 2.1 収集対象のデータ

RootLens が収集するのは、一人称視点で両手が映った家事動作の動画である。映像および関節データは、iOS では ARKit / Core ML、Android では MediaPipe Hand Landmarker に準拠した形式で記録される。Apple の EgoDex に近い構造のデータを生成する。

デバイスは限定しない。デバイスごとのセンサー差（深度センサーの有無、IMU の精度、関節モデルのトポロジーなど）はメタデータとして記録され、購入時にフィルタリングできるようにする。ARKit の 21 関節モデルと MediaPipe の 21 ランドマークモデルではトポロジーが異なるため、プラットフォームとデバイスモデルによるカテゴライズを行い、AI 企業が用途に応じてデータを選別できるようにする。Android 端末のデータが学習に与える貢献度が iOS と異なる場合、ライセンス販売価格で調整する。

両手が映る一人称視点で撮影するという要件上、ユーザーにはヘッドマウントまたはネックストラップ型のスマートフォンホルダーの使用が推奨される。これらは市場に安価に流通している。

### 2.2 タスクの定義

撮影対象の家事は、RootLens が事前に定義した有限のタスクリストから選択する。各タスクは、開始条件と終了条件を持つ。タスクの例：

- 洗濯物を畳む
- 食器を洗う
- 料理の下ごしらえをする
- 掃除機をかける

タスクリストは運営が管理し、需要に応じて追加・変更する。

### 2.3 用語整理：達成確度と品質スコア

本仕様ではこれまで「スコア」と一語で扱っていたものを、 性質の違う以下の二つに分離する。

- **達成確度 (achievement confidence)**: 撮影開始時と終了時のフレームを VLM (Claude Sonnet) に投げて、 選ばれたタスクの開始条件・終了条件にどの程度合致していたかを 0〜100% で返した値。 撮影者がその場で見るもの。 タスクどおりのものを撮ったかの照合のために使う。 映像そのものの品質は測っていない。
- **品質スコア (quality score)**: 撮影された映像そのものの良し悪し。 両手の出現率、 深度データの有効率、 IMU と映像の整合性、 フレーム欠落数などを総合した値。 サーバ側パイプラインが計算する。 ライセンス販売における商品価値の指標として使う。

達成確度と品質スコアは独立した値である。 達成確度が高くても品質スコアが低いことはありうる (例: タスクどおりに撮ったが手の出現率が低かった場合)。 逆もありうる (タスクと違うものを撮ったが映像自体は鮮明な場合)。

### 2.4 撮影フロー

撮影は次の手順で行われる。

**1. タスク選択。** ユーザーはアプリ上でタスクリストから撮影するタスクを選ぶ。

**2. 開始ジェスチャー。** ユーザーは両手をカメラに向けてパー (開掌) のジェスチャーを行う。 アプリは両手の 21 × 2 = 42 関節 (iOS) またはランドマーク (Android) すべてがフレーム内に検出されていることを確認する。 42 点が 1 秒間継続して検出されると、 次のステップに進む。

**3. 開始条件の検証。** 撮影開始時のフレームを VLM に送信し、 選択されたタスクの開始条件への達成確度を取得する。 合格すると、 カウントダウンが始まり、 撮影が開始される。

**4. タスクの実行。** ユーザーは家事を行う。 この間、 RGB ストリームが AVAssetWriter / MediaRecorder により H.264 MP4 として記録される。 端末側 hand pose 検出はリアルタイム UX フィードバック (= 両手フレーミング表示) のためにのみ動作し、 永続化はしない (= 関節データ等は server がアップロードされた MP4 から再抽出する)。

**5. 終了ジェスチャー。** タスクが完了したら、 ユーザーは両手でサムズアップのジェスチャーを 1 秒間行う。

**6. 達成確度の表示とユーザー判断。** 終了時のフレームを VLM に送信し、 終了条件に対する達成確度を取得する。 撮影者には「達成確度: X%」 と「送る」「撮り直す」 の二つのボタンが表示される。

- 「撮り直す」 を選んだ場合、 録画した MP4 は端末上で破棄する。 サーバには送らず、 端末ストレージにも残さない。 達成確度が低くてもこの選択を強制はしない (= ユーザーの意思を優先する)。
- 「送る」 を選んだ場合、 達成確度の値に関わらず必ずサーバに送る。 達成確度はメタデータとしてサーバ側パイプラインに伝達され、 後にカタログでのフィルタ軸として使われる。

達成確度による自動棄却 (= 端末側で「VLM が低いと言ったから送らない」 と判断すること) は行わない。 10 分間撮影したものを VLM のひと目で棄てる権限は撮影端末にはなく、 撮影者の判断を上位に置く。

**7. コレクションへの遷移。** ユーザーが「送る」 を選択した瞬間、 撮影フローは完了する。 アプリはホームタブのコレクション画面に遷移し、 新しいクリップが「アップロード中」 状態のカードとして表示される。 これ以降の処理 (= アップロード、 サーバ側パイプライン、 通知) はバックグラウンドで進行する。 クリップの状態機械は §2.7 を参照。

### 2.5 プライバシー保護の所在

エゴセントリック視点かつ両手が映る家事動画に撮影対象を限定することで、 プライバシーリスクは構造的に低減される。 カメラは撮影者の手元を向いており、 他者の顔が正面から映ることは少ない。

匿名化処理 (= 顔ぼかし) はすべてサーバ側で実行する。 端末側ではぼかし処理を行わない。 これは「アプリ画面で見たぼかし」 と「公開される配信のぼかし」 がズレるリスクを構造的に排除するため、 また配布データセットで ぼかし基準を統一するためである。

テキスト (= 看板 / 書類 / 画面の文字) のぼかしは行わない。 業界標準 (= Meta EgoBlur 公式 / Brighter AI / Celantur) は face + license plate のみで、 「全シーンテキストの blur」 は egocentric setting で技術的に未解決 (= EasyOCR / DBNet / PP-OCRv5 のいずれも recall 50-70% / false positive 多発で実用にならない)。 個人情報を含む書類・画面の写り込みは scenario design (= 撮影 task の指示と例示) + 撮影者の consent flow で担保する。

ぼかし済みコンテンツの確認とユーザー承認はステーキング画面で行う (§4.2 参照)。 ステーキングを選択する行為自体が「ぼかしの確認」 と「カタログ公開の許可」 の両方を兼ねる。

### 2.6 VLM 検証のコスト構造と範囲

VLM の呼び出しは 1 クリップあたり 2 回 (開始時と終了時の各 1 フレーム) に限定される。 動画全体の分析 (dense action label の付与など) は、 §6.2 のサーバー側処理パイプラインの範囲であり、 撮影フロー内では行わない。

VLM が出すのは達成確度 (§2.3 参照) のみであり、 映像の品質スコアは出さない。 品質スコアの算出はサーバ側パイプラインの責務 (§6.2 参照) である。 Root NFT は撮影内容の品質を保証するものではなく、 C2PA 署名による改ざんなしの証明とコンテンツの識別子としての役割を持つ (§3.3 参照)。

### 2.7 コレクション画面のクリップ状態機械

撮影者が「送る」 を選んだクリップは、 コレクション画面のカードとして次のいずれかの状態を取る。 状態遷移はサーバ側のイベントによって駆動される。

| 状態 | 内容 | ユーザーができる操作 |
|---|---|---|
| アップロード中 | MP4 を端末からサーバへ転送している最中 | キャンセル可能。 アプリを閉じても継続 (= §2.8) |
| 処理中 | サーバ側パイプラインのステップ (§6.2) を実行中 | 待つ。 内訳の現在ステップは表示される |
| 準備完了 | サーバ側パイプラインが正常終了し、 ステーキング可能 | ステーキング、 または削除 |
| ステーキング済み | Bubblegum delegate が RootLens に設定されており、 ライセンス販売の対象 | 委任解除 (= アンステーク)、 売上引き出し |
| 処理エラー | サーバ側パイプラインの技術的失敗 (= TP 到達不能、 ぼかし処理失敗 等) で再試行上限を超えた | サポートへの連絡、 削除 |

品質評価は閾値による棄却を行わない (= §6.3 参照)。 品質スコアは買い手向けのフィルタ軸として表示されるメタデータに留め、 「準備完了」 「ステーキング済み」 のクリップにも低品質のものが含まれうる。 撮影者が撮ったものを「品質を理由に運営が棄却する」 構造を持たない。

「アップロード中」 を可視化しないと、 撮影者は撮影直後に端末画面を消したあとデータがどこにあるか分からなくなり、 アップロード失敗時に気付けない。 ここは省略不可能な状態。

### 2.8 アップロードのバックグラウンド継続

MP4 ファイルは典型的に数十 MB〜数百 MB (= H.264 圧縮による)。 撮影者が撮影直後に端末画面を消す、 別のタスクの撮影を始める、 端末を再起動する、 通信が一時的に切れる、 といった状況下でもアップロードは継続できる必要がある。

実装方針:

- iOS は `URLSessionConfiguration.background`、 Android は `WorkManager` を用い、 アプリがフォアグラウンドでなくても OS がアップロード完了まで担保する仕組みに乗せる。
- アップロード先は R2 の事前署名 URL を用いた multipart upload (= チャンク単位の分割送信)。 各チャンクは独立に再試行可能。
- アップロード ID は MP4 ファイルの暗号学的ハッシュから決定論的に導出する。 通信切断や端末再起動で送信が中断した場合、 続きから再開できる。 重複アップロードはサーバ側でハッシュ照合により排除する (§4.3 参照)。

「デモ段階だからフォアグラウンドのみで十分」 とはしない。 撮影者がアプリを閉じて家事を続ける、 という最も自然な利用パターンで詰まる挙動になるため、 最初から正しく実装する。

### 2.9 処理完了の通知

サーバ側パイプラインの完了 (= 状態が「処理中」 から「準備完了」 に遷移したタイミング、 または技術的失敗で「処理エラー」 に陥ったタイミング) は、 端末への push 通知で伝える。

実装方針:

- `expo-notifications` 経由で APNs (iOS) / FCM (Android) に登録する。
- 通知ペイロードにはクリップ ID と新しい状態を含めるが、 個人情報は含めない。
- 通知を切っているユーザーや、 通知の到達が保証されない端末のために、 アプリがフォアグラウンドに戻ったタイミングで、 サーバから全クリップの最新状態を取得する fallback を持つ。

通知のみだと通知設定をオフにしている撮影者に伝わらない。 フォアグラウンド時の取り直しのみだと、 撮影者はコレクション画面を何度も手動で更新する必要が生じる。 二つを組み合わせることで、 どの端末設定でも結果が必ず見える。

### 2.10 C2PA 署名の段階

C2PA 署名は二段階で付与される。

**段階 1 (MVP 必須): サーバ受領後の派生署名**
サーバが MP4 を受領した時点で、 ぼかし処理後の MP4 にサーバ証明書で C2PA 署名 (= 「署名 S」) を付ける。 これは「この MP4 は RootLens のサーバ処理 (= ぼかし含む) を経た」 を証明する。 配信される MCAP の元となる MP4 はこの署名を含む。

**段階 2 (将来追加): 端末 TEE による撮影署名**
撮影された動画に、 端末側でも C2PA 署名 (= 「署名 D」) を付与する。 署名の鍵は端末の TEE (iOS Secure Enclave または Android StrongBox) 内で生成・管理され、 秘密鍵は TEE の外に出ない。 この鍵に対して RootLens が運営する認証局のデバイス証明書が紐づく。 段階 2 が動き始めると、 サーバの派生署名 「署名 S」 は端末署名 「署名 D」 を C2PA ingredient として参照する形になり、 ingredient chain で端末由来まで遡れる。

段階 1 のみで TP の `core-c2pa` processor の検証は通る (= サーバ証明書も RootLens 認証局配下の正当な証明書)。 段階 2 を加えると 「端末で実際に撮影された」 ことの暗号学的証明が連鎖として付く。 LP の 「信じる必要はない」 の最終形には段階 2 が必要だが、 段階 1 のみでも 「License 記録が公開検証可能」 + 「サーバ処理の改ざんなし」 は成立する。

認証局の構造とデバイス証明書の発行・更新フローについては、 別途セキュリティ仕様書で定める。

---

## 3. Title Protocol の利用範囲

### 3.1 TP の役割

TP は **コンテンツとオンチェーンレコード (= cNFT) の暗号学的 binding を、 第三者が独立に検証可能な形で保証する** インフラ。 具体的には:

1. C2PA 付きコンテンツを TEE 内で受け取り
2. C2PA 署名と ingredient chain を検証
3. 検証結果と content hash を TEE 鍵で署名
4. Solana 上に Root NFT (cNFT) として発行

RootLens における TP の役割はこの 4 つに限定する。 知覚ハッシュ / 深度マップ / その他センサーデータの抽出オンチェーン記録は TP の範囲ではなく、 RootLens サーバ側パイプラインで行う。

#### なぜ TP 経由が MVP から必須か

LP の核心命題は 「私たちを信じる必要はない、 ブロックチェーンで全て検証できる」。 これが成立するためには、 **オンチェーンの License NFT 連鎖を辿った先の Root NFT が、 実際の配信コンテンツとバイト単位で一致していること** を、 RootLens を信頼せずに検証できる必要がある。

仮に RootLens サーバが Bubblegum を直接叩いて Root NFT を自己発行する設計だと:

- 「この cNFT に対応するコンテンツ hash は X」 を表明しているのは **RootLens サーバの自己署名のみ**
- 第三者は 「RootLens がこの cNFT と配信ファイルを正しく対応付けている」 ことを信用するしかない
- これは LP の 「信じる必要はない」 と直接矛盾する

TP の TEE attestation を経由すると:

- content hash と cNFT の binding は TP の TEE 鍵で署名される
- TEE attestation は独立検証可能 (= TP の WASM hash がオンチェーン pin、 ノード署名鍵が公開)
- RootLens 自身が binding を偽造することができない
- 結果として、 LP の暗号学的裏付けが成立する

つまり TP は「将来のオプション」 ではなく、 LP 命題を成立させる **不可欠な構成要素**。

### 3.2 TP はステートレス

TP は過去に発行したコンテンツの記録を持たない。したがって、同一の動画を TP に複数回登録し、複数の Root NFT を発行することはプロトコルレベルでは防げない。重複の排除は RootLens のアプリケーション層で行う（§4.3 参照）。

### 3.3 Root NFT の意味

Root NFT は、コンテンツのパスポートである。パスポートが国籍と身元を証明するが保持者の能力や品質を保証しないように、Root NFT はコンテンツの真正性を証明するが内容の品質を保証しない。

具体的には、Root NFT は次の二つの意味を持つ。

1. **撮影証明（コンテンツ ID）**：C2PA 署名が検証済みであり、正規のデバイスで撮影された改ざんのないコンテンツであることの証明。Title Protocol の Root NFT Collection (= Extension cNFT 専用 collection) に属することで、RootLens の TEE ノードから発行されたことが保証される。コンテンツの一意な識別子として機能する。
2. **ライセンス発行権の鍵**：この Root NFT の delegate は、対応するコンテンツに対して License NFT の発行に co-sign する権限を持つ（§5 参照）。この権限は、§4.4 の著作権利用許諾に基づく。 Root NFT 自身がこの法的役割を自己証明するための TEE 署名付き binding メタデータの仕様は §3.4 (RootLens 専用 Extension `rootlens-license-v1`) で定める。

### 3.4 RootLens 専用 Extension の定義 (`rootlens-license-v1`)

Root NFT が「ライセンス発行権の鍵」 としての法的ニュアンスを **自己証明** できるよう、 TP に専用の Extension WASM を実装する。 この WASM は、 TP の `/verify` リクエスト時に `processor_ids: ["rootlens-license-v1"]` で実行され、 TEE 署名付きの Extension cNFT として発行される。 (TP の Extension 機構については別途 Title Protocol SPECS §3.4 を参照)

#### 3.4.1 設計意図

通常の Extension cNFT は WASM 出力の客観属性 (= perceptual hash 等) を記録する。 これに対し `rootlens-license-v1` は、 **「このコンテンツは RootLens のサブライセンス枠組み下で利用許諾を発行可能なものとして登録された」 という事実を、 TEE 署名で自己証明する** ことが目的。 撮影者が後で stake (= Bubblegum delegate 設定) すれば、 第三者は Root NFT 単体を見るだけで「これは RootLens フレームワーク所属」 と確認できる。

#### 3.4.2 WASM 入力

TP の標準入力に加え、 `extension_inputs.rootlens-license-v1` として以下を受け取る:

```json
{
  "tos_version": "v1.0.0",
  "tos_hash": "0x...sha256 of the tos text..."
}
```

WASM は撮影者が同意した ToS の version と hash を入力として受け取り、 自身の決定論的処理に取り込む。

#### 3.4.3 WASM 出力 (TEE 署名付き signed_json)

```json
{
  "protocol": "Title-Extension-v1",
  "tee_type": "aws_nitro",
  "tee_pubkey": "...",
  "tee_signature": "...",
  "tee_attestation": "...",
  "payload": {
    "content_hash": "0x...",
    "creator_wallet": "...",
    "extension_id": "rootlens-license-v1",
    "wasm_source": "ar://...",
    "wasm_hash": "0x...",
    "extension_input_hash": "0x... (sha256 of the extension_inputs JSON)",

    "rootlens_binding": {
      "binding_protocol_version": "rootlens-license-v1",
      "purpose": "sublicense-grant-eligibility",

      "license_program_id": "<RootLens License NFT program Solana pubkey>",
      "license_collection_mint": "<RootLens License Collection MPL Core mint pubkey>",
      "license_nft_terms_url_template": "https://rootlens.io/licenses/<type>/<terms_hash>.json",

      "tos_version": "v1.0.0",
      "tos_hash": "0x...",
      "tos_url": "https://rootlens.io/tos/v1.0.0/<tos_hash>.txt",
      "tos_consent_log_endpoint": "https://www.rootlens.io/api/v1/tos/consent",

      "binding_rule_url": "https://rootlens.io/extensions/rootlens-license-v1/<rule_hash>.json",
      "binding_rule_hash": "0x...sha256 of the binding rule document..."
    }
  },
  "attributes": [
    { "trait_type": "protocol", "value": "Title-Extension-v1" },
    { "trait_type": "content_hash", "value": "0x..." },
    { "trait_type": "extension_id", "value": "rootlens-license-v1" },
    { "trait_type": "purpose", "value": "sublicense-grant-eligibility" }
  ]
}
```

#### 3.4.4 `rootlens_binding` 各フィールドの法的役割

| フィールド | 役割 |
|---|---|
| `binding_protocol_version` | この Extension が従う「Root NFT を法的にどう解釈するか」 の規約 version |
| `purpose` | "sublicense-grant-eligibility" 固定。 「**この Root NFT はサブライセンス発行のために登録された**」 を明示 |
| `license_program_id` | License NFT を発行する Solana program pubkey。 第三者は「**この program 経由で発行された License NFT のみ legitimate**」 と判定できる |
| `license_collection_mint` | RootLens 発行 License NFT の Collection mint。 License NFT 検証時に collection を照合 |
| `license_nft_terms_url_template` | License NFT のメタデータ URI のフォーマット (= 「`<type>` と `<terms_hash>` で構成される self-certifying URL」 を明示) |
| `tos_version` / `tos_hash` / `tos_url` | 撮影者が同意した ToS を、 TEE が確かに参照したことを証明。 binding は「**この ToS の文言下** で成立する」 を明示 |
| `tos_consent_log_endpoint` | 第三者が撮影者の ToS 同意レコードを取得する公開 API |
| `binding_rule_url` / `binding_rule_hash` | binding 全体のセマンティクスを定めた人間 + 機械可読な文書 (= 別途 `https://rootlens.io/extensions/rootlens-license-v1/<sha256>.json` で公開、 hash で改ざん検知) |

#### 3.4.5 binding rule 文書 (= URL 先 JSON) のスキーマ

`binding_rule_url` が指す文書は、 「**この Extension cNFT が存在することの法的な意味**」 を平易な言葉で定める:

```json
{
  "version": "1.0",
  "extension_id": "rootlens-license-v1",
  "english": {
    "summary": "An NFT bearing this Extension declares that its content has been registered with RootLens's sublicensing framework. The current Bubblegum delegate of this NFT is the authorized sublicensor. The legal grant exists when both (a) the owner has consented to the referenced ToS version, and (b) the delegate field is set.",
    "full_text": "..."
  },
  "japanese": {
    "summary": "本 Extension を持つ NFT は、 当該コンテンツが RootLens のサブライセンス枠組みに登録されたことを宣言する。 当該 NFT の現 Bubblegum delegate が、 認可されたサブライセンス発行者である。 法的な許諾は、 (a) NFT 所有者が参照 ToS version に同意し、 かつ (b) delegate field が設定されているとき、 成立する。",
    "full_text": "..."
  },
  "verification_steps": [
    "1. Verify NFT collection == license_collection_mint via DAS",
    "2. Verify TEE signature on the Extension cNFT signed_json",
    "3. Fetch ToS at tos_url and verify sha256 matches tos_hash",
    "4. Query tos_consent_log_endpoint with creator_wallet, verify consent record exists for tos_version",
    "5. Read current Bubblegum delegate of the NFT (= the authorized sublicensor at this moment)"
  ]
}
```

#### 3.4.6 第三者検証の流れ (= Root NFT 単独での自己証明可能性、 License NFT 発行前の検証)

本節は、 License NFT がまだ発行されていない段階で、 Root NFT 単体から「この NFT は RootLens のサブライセンス枠組み所属である」 ことが暗号学的に確認できるかを扱う。 License NFT が発行された後の **完全な連鎖の検証** は §4.4.6 を参照のこと。

任意の第三者が Root NFT 単体から、 以下を独立に検証できる:

1. Root NFT の TEE 署名 → 撮影者 wallet, content_hash, rootlens_binding の整合性
2. `binding_rule_url` から rule 文書を fetch → sha256 が `binding_rule_hash` と一致 → 改ざん検知
3. `tos_url` から ToS 文書を fetch → sha256 が `tos_hash` と一致 → 撮影者が同意した条文を確認
4. `tos_consent_log_endpoint` で撮影者 wallet の同意レコード照会 → tos_version と一致を確認
5. Bubblegum 標準機能で Root NFT の現 delegate を取得 → 「現在の正当なサブライセンス発行権者」 を確定

ステップ 1〜5 全てが pass すれば、 **Root NFT 単体で「**この NFT は法的にサブライセンス可能な対象であり、 現 delegate が認可された発行権者である**」 が暗号学的に証明される**。 License NFT が後から発行されるかどうかとは独立に、 Root NFT 自体に法的ニュアンスが乗る。

---

## 4. ステーキング（delegate 設定）

### 4.1 ステーキングの前提条件

ステーキングが可能なのは、 §2.7 のクリップ状態機械において「準備完了」 状態にあるクリップのみである。 つまり、 ステーキング画面に到達するには、 以下のすべてが既に完了している必要がある。

1. クライアントからサーバへの MCAP アップロード (§2.8)。
2. サーバ側パイプラインの全ステップ (§6.2): C2PA 事前検証、 匿名化、 派生 manifest 生成、 品質評価、 TP 提出と Root NFT 発行、 R2 配置。

品質スコアの高低は前提条件ではない (= §6.3、 棄却閾値なし)。 撮影者は品質に関係なく自分のクリップをステーキングできる。

ステーキング画面では、 撮影者は次のものを見て意思決定する: ぼかし済みコンテンツのプレビュー、 品質スコアと内訳、 想定される報酬レンジ。 ステーキングを承認する行為自体が「ぼかしの確認」 と「カタログ公開の許可」 の両方を兼ねる (= 別々の承認ステップに分割しない)。 詳細な UX 要件は §4.2 を参照。

### 4.2 ステーキングの仕組みと画面要件

ステーキングとは、 Root NFT (cNFT) の delegate を RootLens のアドレスに設定することである。 Bubblegum の標準機能 (delegate 命令) を使用する。 動画ごとの PDA は作成しない。

#### 入口

ステーキング画面は、 コレクション画面のクリップ詳細 (= §2.7 で「準備完了」 状態にあるカードをタップ) から呼び出す確認シートとして実装する。 独立した画面として撮影フローの直線上に置かない (= 撮影フローは撮影者の「送る」 選択で完了するため、 ステーキングは別の意思決定として撮影と切り離す)。

#### ステーキング画面で表示するもの

撮影者は、 ステーキングを承認する前に同じ画面上で次のすべてを確認する。

1. **ぼかし済みコンテンツのプレビュー** (= 顔にぼかしが乗ったいくつかの代表フレーム)。 これが「ぼかしの確認」 を兼ねる (= §2.5 で承認ステップをここに統合した結果)。
2. **品質スコアと内訳** (= 両手の出現率、 深度有効率、 IMU 整合性、 フレーム欠落数のサブスコア)。 撮影者がなぜこの点数になったかを理解できるようにする。
3. **想定される報酬レンジ** (= 品質スコアとタスク種別に基づく試算)。
4. **撤回不能性の注意喚起**: 「このクリップについて License NFT が 1 つでも発行された後は、 撤回はできません。 ステーキングを解除しても既発行のライセンスは永続します。」 を明示し、 撮影者はチェックボックスでこれを読んだことを示す (= 二段階確認の前半)。
5. **ステーキング実行ボタン**: 上記 4 のチェックが入っていないと活性化しない。 押下後にもう一段の最終確認ダイアログを出す (= 二段階確認の後半)。

#### 実行と委任の意味

ステーキング実行は Bubblegum の delegate 命令により、 Root NFT の delegate を RootLens のアドレスに設定する。 ユーザーの署名が必要。

Root NFT の所有権はユーザーのウォレットに残る。 RootLens が得るのは delegate 権限のみであり、 Root NFT を直接保有することはない。

Bubblegum の delegate は仕様上、 cNFT の移転 (transfer) 権限も持つ。 この権限の行使は §4.4 の利用規約により法的に制限される。 ユーザーはいつでも delegate を解除でき、 万一 RootLens が不正に Root NFT を移転した場合、 その事実はオンチェーンで証拠として残る。

### 4.3 重複排除

RootLens は、アプリケーション層で動画データの暗号学的ハッシュを管理し、同一動画の二重アップロードを排除する。R2 にアップロード済みの動画と一致するものは、ステーキング対象としない。

知覚ハッシュや埋め込みベースの類似度検索による近似重複の検出は、MVP の範囲外とし、必要に応じて追加する。

TP がステートレスであるため、ユーザーが RootLens を介さず TP に直接登録して 2 つ目の Root NFT を作ることは技術的に可能である。しかし、対応する動画データが RootLens の R2 に存在しない Root NFT を RootLens がステーキング対象として受け入れることはないため、実害は生じない。

### 4.4 著作権利用許諾とサブライセンス連鎖

撮影者は動画の著作権を保持する。本節は、撮影者から License NFT 保有者までの法的権限の連鎖を定義する。

#### 4.4.1 連鎖の構造（撮影者 → delegate → License NFT 保有者）

```
[撮影者] (著作権保有)
   │ §4.4.3 ToS 同意 (click-through + ed25519 署名)
   ↓ サブライセンス可能な著作権利用許諾を付与
[Root NFT delegate] (= 通常 RootLens、Bubblegum delegate 経由 §4.2)
   │ §5.3 co-sign による issue_license 実行
   ↓ サブライセンスを発行
[License NFT 保有者] (= 最終ライセンシー、§5.5.1 一方的許諾)
```

各段階の法的根拠:

| 段階 | 根拠 | 形式 |
|---|---|---|
| 撮影者 → delegate | 本 §4.4 の利用規約条文 | オフチェーン契約（撮影者が ToS 同意時に成立） |
| delegate → License 保有者 | License NFT の URI が指す license JSON 内の条文 | 一方的許諾（§5.5.1）、契約ではない |

#### 4.4.2 ToS のバージョン管理、 公開、 および冒頭サマリ

ToS は version 単位で管理し、 各 version は immutable な R2 URL に置かれ、`sha256` ハッシュが識別子となる。

```
https://rootlens.io/tos/v<MAJOR>.<MINOR>.<PATCH>/<tos_hash>.txt
例:
https://rootlens.io/tos/v1.0.0/<tos_hash>.txt
```

ToS の改訂が必要な場合は新 version を発行する。 既存 version は永続的に同 URL で参照可能。 撮影者は同意した version でのみ拘束される (後続 version の改定が遡及適用されることはない)。

##### 冒頭サマリ (7 項目) の必須化

利用規約の冒頭には、 正式な条文より前に「**この同意でどんな約束が成立するか**」 を平易な日本語の 7 つの箇条書きで示す前置きを必須化する (= 撮影者が正式条文を読まなくても、 同意の中身を本質的に理解できるようにするため)。 7 つの内容:

1. RootLens に対し、 自分の動画について再許諾を発行する権限を委任する。
2. 動画の著作権そのものは撮影者が保持し続ける。
3. 収益分配はスマートコントラクトで自動的に行われる。
4. License NFT が 1 つでも発行された後は、 その動画について撤回はできない。 stake を解除しても、 既発行のライセンスは永続する。 unstake はあくまで「将来の新規ライセンス発行を止める」 操作のみである。
5. 撮影者は当該動画の著作権者である旨、 および第三者の著作物・肖像権・パブリシティ権が含まれていない旨を表明する。 違反したら撮影者自身が経済的責任を負う (= もし買い手が訴えられて RootLens が補償した場合、 RootLens が撮影者に求償する)。
6. AI 学習目的での圧縮や改変等の技術的処理について、 著作者人格権を行使しないことを約束する。 ただし著作者の名誉・声望を害する態様での改変は除く。
7. 紛争はシンガポール国際仲裁センター (SIAC) で解決する。

#### 4.4.3 ToS 同意フロー

ユーザー × ToS version 単位で 1 回の同意を記録する。 一般的な Web サービス (Google / Twitter / Apple 等) と同等のクリックスルー方式である。

1. ユーザーがアプリを初回起動した時、 または ToS が新 version に更新された後の初回起動時、 アプリが現行 ToS の (`version`, `tos_hash`, `tos_url`, §4.4.2 の 7 項目サマリ, `tos_text` 全文) を表示し、 明示的同意を求める (チェックボックス + 全文スクロール完了)。
2. RootLens は同意イベントをサーバ側に記録する:
   - `wallet_pubkey` (ユーザー識別子)
   - `tos_version`
   - `tos_hash` (改ざん検知用)
   - `consented_at` (ISO8601)
   - `ip_address`、 `user_agent` 等の Web2 標準メタデータ
3. 以後、 同 version 下では再同意は不要。 ユーザーは staking (§4.2) 等の通常操作に進む。
4. ToS が新 version に更新されたら、 次回ユーザーがアプリを起動した際にステップ 1 から再実行する。

**証拠保全** は一般的な Web サービスと同等の事業者責任で行う。 `tos_hash` を記録することで「どの version に同意したか」 が後から検証可能となる。 RootLens は append-only に近いストレージ (immutable backups + audit log) で記録を保管する義務を負う。

> **設計判断**: 当初は ed25519 ウォレット署名や Solana memo プログラムを経由したオンチェーン化を検討したが、以下の理由で一般のウェブサービスと同等の方式を採用した。
> - ToS 同意は「ユーザー × version」で年に数回程度しか発生しないイベント。1 同意ごとにウォレット署名を要求するのは、 ユーザー体験の負担が大きすぎる。
> - License NFT 発行 (§5.3) は企業間取引であり、 当事者は本人確認済の AI 企業。 許諾者側がライセンシー側の同意の有無を争うシナリオは存在しない。
> - RootLens 側で個人ユーザーを著作権侵害で訴える主要シナリオは想定されない (撮影者は寄り添うべき相手であり、係争相手ではない)。
> - クリックスルー同意の証拠能力は、米国では *Meyer v. Uber Technologies, Inc.*, 868 F.3d 66 (2d Cir. 2017) が「合理的に明瞭な提示 + 明示的な同意操作」 を満たせば拘束力ある契約として成立すると判示。 日本では民法第 522 条 (諾成主義) + 第 548 条の 2 (定型約款、 2020 年改正) が成文法上の根拠を提供する。

#### 4.4.4 サブライセンス条文（撮影者から delegate への許諾）

ToS の本文には少なくとも以下の許諾条文を含める。

> **§X 著作権利用許諾**
> 
> 1. **再許諾権の付与**: 撮影者は、 本サービスを通じて発行された動画コンテンツ (以下「対象コンテンツ」) について、 対象コンテンツの **第三者への利用許諾を発行する権限** (= サブライセンス権) を、 自身が **代理人** として指定したアカウントに付与する。
> 
>    1-1. 「**代理人として指定したアカウント**」 とは、 撮影者が対象コンテンツに紐づく Root NFT について、 Solana ブロックチェーン上の Bubblegum 仕様による標準操作を用いて、 代理人 (delegate) として登録したアカウントを指す。 この登録操作を本サービスでは「ステーキング」 と呼ぶ。
> 
>    1-2. 撮影者は、 同じく Bubblegum 標準操作により、 代理人をいつでも変更又は解除できる (= アンステーキング)。
> 
> 2. **再許諾の方法と内容**: 本許諾に基づく再許諾は、 **License NFT の発行を通じてのみ** 行われる。
> 
>    2-1. すなわち代理人は、 本サービスの License NFT スマートコントラクト (= 動画利用権の発行を自動執行するプログラム) を経由して License NFT を発行することによってのみ、 第三者に再許諾を付与する。 これ以外の方法による再許諾は本許諾の範囲外であり、 本許諾を根拠とすることはできない。
> 
>    2-2. 各 License NFT に基づく具体的な利用範囲・条件は、 License NFT の発行時点で当該 NFT のメタデータが指すライセンス文書 (= §5.5.3 が定めるところの license terms) によって定められる。 代理人は発行時に複数のライセンス種別 (例: 商用、 AI 学習専用) から選択する権限を持つ。
> 
>    2-3. 本許諾に基づく再許諾は、 非独占的・全世界的とする。
> 
> 3. **権限濫用の禁止**: 代理人は、 本許諾に基づく権限を License NFT 発行以外の目的に使用してはならない。 具体的には、 Root NFT 自体の譲渡 (transfer)、 焼却 (burn)、 凍結 (freeze)、 その他の処分、 又は対象コンテンツの直接的な複製・配布は、 本許諾の範囲外である。 これらに違反する行為は、 別途撮影者の著作権を侵害する。
> 
> 4. **代理人変更時の効果**:
> 
>    4-1. 撮影者が代理人を変更又は解除した場合、 変更後は元の代理人は対象コンテンツに関する **新規** License NFT の発行に署名する権限を失う。
> 
>    4-2. 代理人の変更又は解除前に既に発行された License NFT は影響を受けない。 当該 License NFT に紐づく license terms に定められた範囲・期間で、 利用許諾は存続する。
> 
> 5. **撤回**: 撮影者は、 当該対象コンテンツについて License NFT が一切発行されていない時点に限り、 本許諾をいつでも撤回できる (= アンステーキングが撤回方法となる)。 既に発行された License NFT は撤回の対象外であり、 それぞれの license terms に従う。
> 
> 6. **成立時点**: 本許諾は、 撮影者が本 ToS の特定 version に同意した時点で、 当該 version の同意対象コンテンツについて成立する。
> 
> 7. **著作者人格権の不行使特約**: 撮影者は、 対象コンテンツについて、 代理人および License NFT 保有者に対し、 license terms が定める利用範囲内における利用 (= 圧縮・形式変換・AI 学習目的の中間処理を含む技術的適合のための改変を含む) に限り、 著作者人格権 (同一性保持権、 公表権、 氏名表示権) を行使しないことを約する。 ただし、 著作者の名誉又は声望を害する態様での改変については本特約は適用されない。 著作権法第 59 条により著作者人格権は一身専属であるため、 これは権利の放棄ではなく、 行使しないことの約束として構成される。

#### 4.4.5 delegate 変更時の継承

撮影者が delegate を別アドレスに変更した場合、本許諾は新 delegate に対して同一条件で再付与される（撮影者は ToS で「現在 delegate に設定されている者」に許諾を付与しているため、Bubblegum delegate の状態変化に追従する）。新 delegate は変更時点以降の新規 License NFT 発行についてのみ権限を持つ。

#### 4.4.6 連鎖の検証可能性 (= License NFT 発行済 case の完全連鎖検証)

本節は、 License NFT が発行された後、 「Root NFT → ToS 同意 → 代理人 → License NFT 保有者」 の **完全な権限連鎖** を第三者が独立に検証する手順を定める。 License NFT 発行前の Root NFT 単独の自己証明可能性は §3.4.6 を参照のこと。

ある License NFT の正当性は、 以下のチェーンを辿ることで第三者が検証できる。 §3.4 で定義した RootLens 専用 Extension `rootlens-license-v1` が、 検証に必要な ToS version / hash / endpoint 等を Root NFT 内の TEE 署名付きメタデータで自己証明する。

1. **License NFT の発行確定性**: License NFT の collection を取得 → §5.5.3 で定義した License Collection と一致することを確認
2. **License NFT ↔ Root NFT 紐付け**: License NFT の URI から `?root_mint=<root_asset_id>` をパース → 紐づく Root NFT を特定 (§5.5.3 Layer 1)
3. **Root NFT の正当性 + binding 情報**: Root NFT を DAS から取得 → Root NFT Collection 所属、 owner (= 撮影者 wallet)、 および §3.4 の `rootlens_binding` フィールドを取得。 TEE 署名で改ざんなしを確認
4. **ToS 文書の真正性**: `rootlens_binding.tos_url` から ToS 文書を fetch → sha256 が `rootlens_binding.tos_hash` と一致することで改ざんなしを確認
5. **撮影者の同意**: `rootlens_binding.tos_consent_log_endpoint` で撮影者 wallet の同意レコードを取得 → 同意の事実と version を確認
6. **発行時点の代理人**: License NFT 発行 tx の delegate signer pubkey を確認 → 当該 ToS version の条文 (§4.4.4) に照らして、 当時その signer が正当なサブライセンス発行権者だったことを確認
7. **license terms の真正性**: License NFT の URI が指す license JSON を fetch → sha256 が URL 内 hash と一致することで改ざんなしを確認 → 最終ライセンシー (License NFT 保有者) への許諾範囲を確認

ステップ 1〜7 すべてが整合する場合、 License NFT 保有者の権限は、 ToS 同意 → サブライセンス権の付与 → License 発行 → 保有 という連鎖で法的に正当化される。

### 4.5 アンステーク（delegate 解除）

ユーザーは、いつでも Root NFT の delegate を解除できる。Bubblegum の標準機能を使用する。

delegate 解除後の影響：

- 元の delegate は、この Root NFT に対する新規 License NFT の発行に co-sign できなくなる。
- 解除前に発行済みの License NFT は影響を受けない。ライセンス条文に定められた許諾は存続する。
- ユーザーは別のアドレスを新たな delegate に設定できる。

---

## 5. License NFT のコントラクト設計

### 5.1 概要

License NFT は、対応する動画データの利用権を表す cNFT である。License NFT の発行は、delegate と購入者の co-sign によるカスタムプログラムを通じて行われる。ライセンスは非排他（non-exclusive）であり、一つの Root NFT に対して複数の License NFT を発行できる。

コントラクトは汎用的に設計されており、RootLens に依存しない。RootLens は、このコントラクトの上で動くアプリケーションの一つである。

### 5.2 コントラクトの命令

**issue_license**

購入者の署名と delegate の署名の両方を要求する。引数として、Root NFT の Bubblegum proof（root, nonce, index, data_hash, creator_hash, asset_data_hash, flags）、Root NFT Collection の公開鍵、License NFT のメタデータ（uri, name）、価格を受け取る。

プログラムは、Bubblegum V2 の `LeafSchema::V2` を構築し、`spl_account_compression::verify_leaf` 経由で proof を検証する。これにより以下を暗号学的に確認する。

- co-signer が当該 Root NFT の正当な delegate であること（leaf の delegate フィールドと一致）。
- Root NFT が Root NFT Collection (= TP の Extension cNFT 専用 collection) に属すること（引数の root_collection が Config の root_nft_collection と一致、かつ leaf の collection_hash と整合）。これにより、Root NFT が RootLens の TEE ノードから正規に発行されたものであることが保証される。
- Root NFT の owner（ステーカー）のアドレス（leaf の owner フィールドと一致）。

処理：

1. **License NFT 発行**: 1 個の License NFT（cNFT）を、license_tree で指定された Merkle Tree に購入者宛てでミントする。Bubblegum V2 の MintV2 を CPI 経由で呼ぶ。
   - License NFT は **License Collection（MPL Core）** に属する（update_authority = 本プログラムの Config PDA）。
   - **`asset_data` フィールドに `root_asset_id` の 32 バイトを書き込む**。Bubblegum がこれを sha256 ハッシュ化して `asset_data_hash` として leaf に焼き込む。これにより License NFT が特定の Root NFT に対するライセンスであることが暗号学的に固定される（§5.5.3 参照）。
   - `root_asset_id` はプログラムが proof から導出するため、caller は偽装できない。
   - License NFT のメタデータ URI は caller が指定し、ライセンス種別ごとに異なる URL を渡せる（商用利用権、二次販売権、AI 学習限定など、§5.5.3）。
2. price 分の USDC を購入者のウォレットからプログラム PDA に移転する。
3. ステーカーのユーザー収益アカウント（PDA）が存在しない場合、初期化する。作成コストは購入者のトランザクション手数料に含まれる。
4. price の `staker_basis_points / 10000` の比率を、 ステーカーのユーザー収益アカウントの残高に加算する。
5. price の `delegate_basis_points / 10000` の比率を、 delegate のウォレットに即時送金する。

license_tree は呼び出し時に引数として指定する。本プログラムの PDA `[b"tree_authority", license_merkle_tree.key()]` を tree authority として持つ tree のみを受け付ける（プログラム経由でしか mint できないことを保証）。Tree がいっぱいになった場合は、同じパターンの新しい Tree を本プログラムの `create_license_tree` 命令で作成し、以降の issue_license で新しい Tree のアドレスを渡せばよい。プログラムの変更は不要である。

**claim_revenue()**

ユーザーの署名を要求する。ユーザー収益アカウント（PDA）の未分配残高全額を、ユーザーのウォレットに送金する。残高を 0 にリセットする。ユーザーがステーキングしているすべての Root NFT の累積収益を一括で引き出す。

### 5.3 co-sign による発行フロー

License NFT の発行は、以下のフローで行われる。RootLens を例として説明する。

1. AI 企業が RootLens のカタログから購入するデータを選ぶ。RootLens はカタログに、適用されるライセンス種別（商用利用権、AI 学習限定、二次販売権など）の URL を提示する。各 URL は §5.5.3 のとおり条文ハッシュを path に含む self-certifying URL である。
2. AI 企業が issue_license トランザクションを構築する（Root NFT proof 引数、metadata_uri、price、license_tree 等を指定）。metadata_uri は §5.5.3 の self-certifying URL から選んだもの。
3. AI 企業がトランザクションに署名し、RootLens の API に送信する。
4. RootLens が検証する：当該 Root NFT が自社に delegate されているか、price は許容範囲か、選ばれた license URL が許可リストに含まれるか。
5. RootLens がトランザクションに co-sign する。
6. トランザクションが Solana に送信され、実行される。
7. 1 つのトランザクション内で、License NFT の発行（Bubblegum V2 MintV2 経由、`asset_data = root_asset_id` で Root NFT に暗号学的に bind）、USDC の移転、収益の分配がアトミックに完了する。

このフローにより、RootLens は License NFT の在庫を持つ必要がない。発行・販売・収益分配が単一のトランザクションで完結する。

### 5.4 収益分配

#### 5.4.1 アカウント構造

収益分配には以下のアカウントを使用する。

- **プログラム PDA（USDC プール）**：すべての USDC を保持する単一のアカウント。
- **ユーザー収益アカウント（PDA）**：ユーザーのウォレットアドレスから導出される、ユーザー 1 人につき 1 個のアカウント。累積収益残高を記録する。初回の issue_license 実行時に自動作成される。アカウント作成に必要な rent は購入者（AI 企業）のトランザクション手数料に含まれる。

delegate 分はプール内に蓄積せず、 issue_license 実行時に delegate のウォレットに即時送金する。

#### 5.4.2 分配比率

分配比率はステーカー側と delegate 側の 2 つに分割される。 合計は basis points で 10000 (= 100%) となるよう契約で強制 (`Config::validate_split`)。 具体的な比率値はオンチェーン Config (`staker_basis_points` / `delegate_basis_points`) に記録され、 `update_config` 命令により admin が更新可能。 過去発行された License NFT の発行時点の比率は tx ログから遡及確認可能。

#### 5.4.3 支払通貨

収益分配は USDC で行う。

### 5.5 ライセンスの法的構造

#### 5.5.1 一方的許諾（Unilateral License Grant）

License NFT に紐づくライセンスは、契約ではなく、著作権の一方的許諾として構成する。delegate（§4.4 の著作権利用許諾に基づきサブライセンス権を持つ者）が、License NFT の現保有者に対して著作権の利用を一方的に許諾する。License NFT の保有者は、NFT を保有するだけで自動的にライセンシーとなり、クリック同意やサイン等のアクションは不要である。

この構造を採用する理由は、ブロックチェーン上にはクリックスルー同意のような仕組みがなく、NFT を受け取った者が発行者のウェブサイトを訪れたことすらない可能性があるためである。契約ベースのライセンスでは、下流の NFT 保有者が実際にライセンス条文に同意したかどうかが不確実になる。一方的許諾であれば、ライセンシーに義務を課さないため、この問題を回避できる。

#### 5.5.2 Legal-Authoritative モデル

ライセンスの帰属について、本仕様では **Legal-Authoritative** モデルを採用する。すなわち、ライセンスの帰属は原則としてブロックチェーンの状態に従うが、NFT の盗難・詐欺・秘密鍵の漏洩が立証された場合には、裁判所が所有権を修正できる。

RootLens の取引相手は KYC 済みの AI 企業であり、万が一の盗難時に法的救済が可能な方が買い手の安心感に資する。

#### 5.5.3 ライセンス条文のオンチェーン紐付け（二層 binding）

License NFT は二層の暗号学的 binding を持つ。

#### Layer 1: License NFT ↔ Root NFT （プログラムが URI に root_asset_id を append）

License NFT を発行する際、本プログラムは proof 検証を通過した root_asset_id（= `find_program_address([b"asset", root_merkle_tree, nonce], mpl_bubblegum)`）を `?root_mint=<root_asset_id_b58>` の形式で URI 末尾に append する。caller の指定した URI が `https://rootlens.io/licenses/commercial-v1/<terms_hash>.json` だった場合、最終的に MintV2 に渡される URI は:

```
https://rootlens.io/licenses/commercial-v1/<terms_hash>.json?root_mint=<root_asset_id_b58>
```

URI は `MetadataArgsV2.uri` に格納され、Bubblegum の `data_hash` 計算に取り込まれる。`data_hash` は leaf hash の構成要素となるため、mint 後に URI が改ざんされると leaf hash が一致しなくなり tree state と乖離する。**よって URI 全体（root_mint パラメータを含む）は変更不能**。

caller は root_asset_id を偽装できない。proof verify を通過した tree+nonce から program 内で導出され、program が直接 URI に append するため。

第三者は License NFT を DAS から取得して URI の `?root_mint=...` 部分をパースし、主張される Root NFT と照合することで Layer 1 binding を検証できる。

> **設計補足** (snapshot 日: 2026 年 5 月時点 — 将来読み返す際は Bubblegum `asset_data` feature の状況を再確認すること): 理想的には Bubblegum V2 の `asset_data` フィールドに root_asset_id の raw bytes を渡し、 Bubblegum 側で `sha256(asset_data)` を `leaf.asset_data_hash` に焼き込ませるのが、 より構造的に整理されている (`MetadataArgsV2.uri` の意味論的用途と分離できる)。 しかし 2026 年 5 月時点で devnet 上に deploy 済の mpl-bubblegum プログラムが asset_data feature を受け付けない (NotAvailable error 6050) ため、代替として URI 末尾追加方式を採用している。 Bubblegum がこの feature を有効化したら、URI 末尾追加は廃止して asset_data_hash 経由の紐付けに切り替える予定。

#### Layer 2: License NFT ↔ ライセンス条文 （URL self-certifying）

License NFT のオンチェーンメタデータ URI は、ライセンス条文の hash を path に含む self-certifying URL を指す。例：

```
https://rootlens.io/licenses/commercial-v1/<license_terms_hash>.json
https://rootlens.io/licenses/training-only/<license_terms_hash>.json
https://rootlens.io/licenses/redistribution-v2/<license_terms_hash>.json
```

`<license_terms_hash>` は当該 JSON ファイルの sha256 hash の hex 表記である。第三者は URL を fetch した JSON を sha256 ハッシュ化し、URL に含まれる hash と一致することを確認することで、条文が改ざんされていないことを検証できる。URL 自体が条文の identity を保管する。

URI は License NFT の `MetadataArgsV2.uri` に格納され、Bubblegum の `data_hash` の中に取り込まれる。leaf hash の構成要素となるため、mint 後に URI が変更されると leaf hash が一致しなくなり改ざんが検知される。

#### ライセンス条文 JSON のスキーマ

URL 先 JSON は以下のフィールドを含める。 `full_text` には条文の全文を格納し、 構造化されたフィールドと整合させる。

```json
{
  "version": "1.0",
  "license_type": "commercial-v1",
  "binding": {
    "root_mint_format": "solana_pubkey_b58",
    "verification_note": "Verify sha256(b58_decode(this License NFT's bound root_mint)) == leaf.asset_data_hash"
  },
  "terms": {
    "is_unilateral_grant": true,
    "is_contract": false,
    "is_exclusive": false,
    "ledger_authoritative": false,
    "legal_authoritative": true,
    "licensee_identification": "Lawful holder of the License NFT on Solana. The licensee identity is determined by NFT ownership; the mint address need not be enumerated in the terms.",
    "data_identification_method": "The Content licensed under this NFT is the video bound to the Root NFT whose b58-encoded asset id is appended to this License NFT URI as ?root_mint=<...> (see §5.5.3 Layer 1).",
    "permitted_uses": ["ai_training", "commercial_use", "<additional uses depending on license type>"],
    "duration": "perpetual",
    "transfer_rule": "Transfer of the NFT transfers the license, except where theft or fraud is established; in such cases legal remedies prevail (Legal-Authoritative, §5.5.2).",
    "governing_law": "Singapore",
    "dispute_resolution": "Singapore International Arbitration Centre (SIAC), Singapore seat",
    "ny_convention_enforceability": "Awards are enforceable in the 172 NY Convention member states.",
    "sanctions_condition": "License is void ab initio if licensee is on OFAC SDN List, EU Consolidated Financial Sanctions List, UK OFSI Consolidated List, or Singapore MAS Targeted Financial Sanctions List, or is located in a comprehensively sanctioned jurisdiction.",
    "licensor_representations": "The original creator has consented to RootLens ToS as the verified copyright holder under KYC. RootLens has applied its VLM-based pre-screening as a reasonable effort against third-party IP inclusion.",
    "buyer_due_diligence": "For ordinary commercial use including aggregate AI training, the buyer is not required to perform per-asset due diligence on each video.",
    "buyer_notification_duty": "If the buyer has actual knowledge that the Licensed Content contains third-party IP, publicity, or privacy rights, the buyer must promptly notify RootLens in writing.",
    "indemnification": {
      "scope": "Suits by third parties against the buyer for IP, privacy, or publicity rights, within RootLens's representations and warranties.",
      "covered_amounts": ["refund of license fee for the affected License NFT", "buyer's reasonable defence costs incurred before RootLens assumes the defence"],
      "per_claim_cap_usd": "<set per license at issuance>",
      "annual_aggregate_cap_per_buyer_per_root_nft_usd": "<set per license at issuance>",
      "defence_control": "RootLens retains the option to assume defence (counsel selection, settlement, strategy).",
      "exclusions": [
        "Use outside the licensed scope",
        "Cases where the buyer had actual knowledge of the issue but failed to promptly notify RootLens (constructive knowledge is not applied so as not to impose de facto per-asset DD on buyers)",
        "Suits arising from buyer's modification of the Licensed Content"
      ],
      "consequential_damages_exclusion": "Indirect damages (lost future profits, reputational harm, and AI model retraining costs) are excluded by default. Coverage for AI model retraining costs can be agreed separately in an enterprise contract.",
      "enterprise_contract_note": "Buyers requiring coverage above the default caps negotiate an enterprise contract with RootLens, optionally backed by an IP infringement insurance policy. Specific terms are determined at contract time."
    },
    "two_layer_contract_structure": "Buyer-side obligations (notification, sanctions condition, modification limits, scope-of-use limits) are placed in the Terms of Sale, which the buyer accepts explicitly at License NFT purchase. The copyright grant itself remains a stand-alone unilateral licence so that licence inheritance on NFT transfer is preserved."
  },
  "full_text": "<完全な license terms 本文、 発行時点で固定>"
}
```

`full_text` フィールドの条文には少なくとも以下を明記する (= 上記の構造化フィールドと同一内容を、 法的に拘束力ある自然言語で記述する)。

- 本ライセンスは、 著作権の一方的許諾 (unilateral license grant) であり、 契約ではない。
- ライセンスは非排他的 (non-exclusive) である。 同一コンテンツに対して複数のライセンスが存在しうる。
- ライセンシーは、 Solana チェーン上の特定の License NFT を正当に保有する者である (License NFT の mint address は条文中で明示する必要はない、 保有者がライセンシー)。
- NFT の移転はライセンスの移転を伴う。 ただし、 盗難・詐欺の場合は法的救済が優先する (Legal-Authoritative、 §5.5.2)。
- ライセンスの対象となるデータの特定方法 (Layer 1 binding): License NFT URI 末尾の `?root_mint=<root_asset_id>` が指す Root NFT に紐づくコンテンツである旨を記述する。
- 許可される利用範囲 (AI モデルの学習利用、 商用利用、 派生物の生成、 再配布 等) を定める。 種別ごとに異なる URL を用意することで、 運用上柔軟に複数のライセンス条項を発行できる。
- ライセンスの有効期間を定める。
- 準拠法はシンガポール法、 紛争解決はシンガポール国際仲裁センター (SIAC) を指定する。 ニューヨーク条約 (1958) の 172 締約国で仲裁判断が執行可能となる。
- **制裁対象者条件**: licensee が OFAC SDN List、 EU 制裁リスト、 UK OFSI Consolidated List、 シンガポール MAS Targeted Financial Sanctions List に掲載されている場合、 または包括的制裁対象管轄に居住する場合は、 ライセンスは initially から無効とする。 一方的許諾モデルでは licensee に表明を求められないため、 grant 自体を条件付きとする。
- **Licensor の表明保証**: 撮影者は KYC 済の本人で当該コンテンツの著作権者として表明していること、 RootLens は機械的内容判定 (Vision Language Model による事前審査) を合理的努力として実施していることを明記する。 買い手は通常商用利用 (集合的 AI 学習を含む) の範囲では、 動画 1 本ごとの事前審査義務を負わない。
- **補償条項**: 上記 Licensor 表明保証の範囲内で買い手に第三者からの訴訟が発生した場合、 RootLens は (a) 当該 License NFT のライセンス料返金 + (b) 買い手の合理的防御費用 を補償する設計とする。 具体的な上限額・対象範囲・除外項目は、 ライセンス JSON 内の `indemnification` フィールド (= 上記スキーマ参照) と、 買い手が購入時に同意する販売規約 (Terms of Sale) で定義する。 LP / 公開資料では特定の数値を declare せず、 ライセンス購入時点の販売規約で開示する設計とする (= 創業期段階の財務基盤に応じて、 自己資金で履行可能な水準に設定する)。 RootLens は訴訟引受の選択権を持つ。
- **大口契約の取扱**: 上記の既定上限を超える補償、 または AI モデル再訓練費用 等の間接損害の補償が必要な買い手は、 RootLens と個別契約 (= enterprise contract) を締結する。 必要に応じて知的財産権侵害損害保険による裏付けを取得した上で、 個別の条件を合意する。
- **補償対象外となるケース**: (a) 買い手のライセンス範囲を超える利用、 (b) 買い手が問題の存在を実際に知っていた (actual knowledge) のに速やかに通知しなかった場合、 (c) 買い手が Licensed Content を改変した結果として発生した訴訟、 のいずれも補償対象外とする (= 構成的認識は採用しない。 採用すると買い手に個別動画ごとの能動的な事前審査義務を実質的に発生させるため)。
- **責任の限定 (間接損害の取扱)**: 一般的な間接損害 (= 失った将来利益、 評判の損害、 AI モデル再訓練費用 等) は既定で補償対象外。 個別契約で別途合意した場合のみ対象となる。
- **買い手の通知義務**: 買い手は、 Licensed Content の中に第三者の知財・肖像権・パブリシティ権が含まれていることを **実際に知った場合** (= actual knowledge)、 RootLens に書面で速やかに通知する義務を負う。
- **二層契約構造**: 上記の買い手側義務 (通知 / 制裁対象者条件 / 改変制限 / 利用範囲条件 / 補償条項) は **License NFT 購入時に買い手が明示的に同意する 販売規約 (Terms of Sale)** に格納する。 著作権許諾の本体は引き続き一方的許諾文書として独立に置く (= 二層構造)。 これにより、 買い手側義務に拘束力を持たせつつ、 著作権許諾本体は学術モデル (Grimmelmann 型) の一方的許諾を維持し、 NFT 譲渡時の自動継承を保つ。

#### 第三者検証の手順

任意の第三者が以下の手順で「この License NFT 保有者は、この特定動画について、この特定条文の許諾を受けている」を暗号学的に検証できる。

1. License NFT を DAS から取得 → `collection == License Collection` を確認（本プログラム発行確定）
2. `leaf.uri` を取得
3. URI から `?root_mint=<root_asset_id_b58>` をパース → Layer 1 binding が示す Root NFT を特定
4. URI 本体（query 除去）から license JSON を fetch → URL の `<license_terms_hash>` 部分と `sha256(JSON)` を比較（条文改ざんなし）
5. ステップ 3 で取得した Root NFT を DAS から取得 → Root NFT Collection 所属、TP TEE 経由発行を確認
6. Root NFT の URI から TP signed_json → 動画 content_hash で動画ファイルを特定

すべて pass すれば、License NFT 保有者がその動画について JSON 内条文どおりの許諾を受けていることがオンチェーン暗号学的事実として確定する。

#### この設計の根拠

本設計は、 NFT を licensee 識別子として用いる Token-Bound NFT License モデルに依拠する。 この法理は、 二つの独立した出典が同じモデルに収斂する形で支えられている。

- James Grimmelmann (Cornell Tech / Cornell Law / IC3) の *The IC3 NFT License v1.0* (2022 年 11 月公表 / 2023 年 1 月改訂) は、 「The Token-Bound NFT License is structured as a license, rather than a contract. The licensor unilaterally grants a copyright license to the current owner of the NFT.」 と明示し、 NFT は法的効力を持たず、 ライセンス文書側の grant + Invocation mechanism で binding を成立させると学術的に定式化する。
- **ERC-5218 (NFT Rights Management、 James Grimmelmann、 Yan Ji、 Tyler Kell 共著、 Ethereum Foundation 2022)** は、 同型の token-bound license モデルをイーサリアム上のインターフェース仕様として形式化する (`licenseURI()`、 `createLicense()`、 `revokeLicense()` 等を定義)。

両者は別々に公表された成果物だが、 「NFT のメタデータ URI がライセンス文書を指す + ライセンス文書側がライセンシーを **現 NFT 保有者** と定義する」 という同じ構造に帰着する。 本 program の Solana 上実装は ERC-5218 と等価な構造を持ち、 Story Protocol 等の EVM 系列プロジェクトと法的設計が共通する。

業界の参考テンプレートとして Andreessen Horowitz の *"Can't Be Evil" NFT Licenses* (2022 年 8 月、 CC0 公開) があるが、 こちらは契約モデル (= "you agree to these terms") を採用しており、 ERC-5218 ベースの token-bound license とは別系統である。 RootLens は学術モデル (Grimmelmann 型) の unilateral grant を採用するため、 文書側の文言は Creative Commons 4.0 International (CC4) の drafting pattern を参考にする (severability、 多管轄対応、 著作者人格権 不行使条項の構造)。

一方的許諾モデル + smart contract による Licensing Process invocation + 暗号学的 hash linking の三要素により、 blockchain 上のクリックスルー同意の不在を回避しつつ downstream NFT 保有者にも有効なライセンス継承を実現する。

NFT 譲渡時のライセンス自動継承の法的効力は、 米国法では 17 U.S.C. § 204(a) + § 101 (非排他的ライセンスは書面不要)、 日本法では著作権法第 63 条 (利用許諾) + 第 63 条の 2 (利用権の当然対抗、 令和 2 年改正) が支える。著作権法第 63 条の 2 は、 撮影者が将来著作権を第三者に譲渡した場合でも、 既発行 License NFT 保有者の利用権が登録なしで譲受人に対抗できることを明文で保証する。

詳細な法的根拠 + 残る attack surface + 法務レビュー チェックリストは `legal-rationale.md` を参照。

---

## 6. AI 企業への販売

### 6.1 販売フロー

RootLens は、delegate されている Root NFT に対応する処理済みの動画データとセットで、AI 企業に License NFT を販売する。

販売は、§5.3 の co-sign フローに従い、単一の issue_license トランザクションとして実行される。License NFT の発行、USDC の支払い、収益の分配がアトミックに完了する。

### 6.2 処理パイプラインの構成

処理は 3 つの独立したパイプラインに分かれる。 各パイプラインは入力に **データへのリンク** を取り、 出力に別のリンクを返す純粋関数として記述される。 互いに疎結合で、 ストレージ実装 (= R2、 S3、 他) には依存しない。

```
Pipeline 1 (撮影)          rgb.mp4 + sensors.jsonl を生成、 アップロード
                                       ↓
Pipeline 2 (品質評価)      顔ぼかし + 「署名 S」 + 品質 score + Root NFT 発行
                                       ↓
Pipeline 3 (販売データ整形) WiLoR hand pose + LeRobot v3 dataset 構築
```

Pipeline 2 と 3 はサーバ側で動く独立した関数。 詳細実装は [tasks/17-dataset-format/README.md](tasks/17-dataset-format/README.md) と [tasks/17-dataset-format/LeRobotDataset v3.md](tasks/17-dataset-format/LeRobotDataset%20v3.md) を参照。 ここでは各パイプラインの責務だけを定義する。

#### Pipeline 1: 撮影

端末側で完結。 ARKit で同期した RGB + sensor stream を 1 セッションの単位で記録する。 出力ファイル:

| ファイル | 内容 | 形式 |
|---|---|---|
| `rgb.mp4` | エゴセントリック RGB 映像 | H.264, AVAssetWriter, 30 fps |
| `sensors.jsonl` | per-frame の camera pose / IMU 軽量サンプル / tracking_state | JSON Lines, 30 fps |
| `imu_high_rate.jsonl` | 100 Hz の IMU 生サンプル | JSON Lines, 100 Hz |
| `camera_intrinsics.json` | fx / fy / cx / cy + RGB / depth 解像度 | JSON, セッション 1 回 |
| `depth/{frame_id}.png` | LiDAR depth (= Pro 機のみ、 144×256 16-bit) | PNG, 30 fps |

時刻基準は `ARFrame.timestamp` (= デバイス boot からの経過秒)。 全 stream で共通の値を使い、 後段で frame index 同期できる。

#### Pipeline 2: 品質評価

入力: 生データへのリンク (= Pipeline 1 出力)。

処理:

a. **顔ぼかし** ([§2.5](#25-プライバシー保護の所在) 参照)
   ffmpeg pipe で MP4 を raw BGR frame として stream → 各 frame に YuNet (= OpenCV 同梱、 ONNX 232 KB) → ffmpeg で H.264 再 encode。 CPU で 100+ FPS。

b. **C2PA サーバ署名 「署名 S」** ([§2.10](#210-c2pa-署名の段階) 参照)
   ぼかし済 MP4 に C2PA manifest を埋め込む。 `c2pa.placed.face_blur` actions、 RootLens サーバ証明書による ES256 署名。 入力 MP4 に端末署名 (= 「署名 D」) があれば ingredient として参照。

c. **品質スコア算出** ([§6.3](#63-品質スコアの算出と意味) 参照)
   ぼかし済 MP4 から手の出現率 / RGB-IMU 同期率 / フレーム欠落数 等を計算、 0〜100 の総合スコアを出す。

d. **TP 提出と Root NFT 発行**
   ぼかし済 MP4 (= 署名 S 付き) を `@title-protocol/sdk` の `TitleClient.register` に渡す:

   ```typescript
   const result = await client.register({
     content: signedBlurredMp4Buffer,
     ownerWallet: clipOwnerPubkey,
     processorIds: ["core-c2pa"],
     delegateMint: true,
   });
   ```

   TP の TEE 内で 署名 S を `c2pa-rs` で検証 + ingredient chain walk back し、 MP4 content hash を `content_hash` とする Root NFT (cNFT) を Solana に発行する。 TEE は最後まで RootLens にも TP node 運用者にもコンテンツを開示しないため、 結果として配信される Root NFT は content↔cNFT の binding が独立検証可能。

出力: ぼかし済 MP4 へのリンク + 品質スコア + root_asset_id。

#### Pipeline 3: 販売データ整形

入力: 生データへのリンク + Pipeline 2 で得た root_asset_id。

処理:

a. **手姿勢推定**
   ぼかし済 MP4 の各 frame を WiLoR (= 内蔵 YOLO + transformer reconstruction) に入れて、 MANO pose 48-dim + shape 10-dim + 21 keypoint 3D を両手分取得。

b. **per-frame parquet 構築**
   Pipeline 1 の sensors.jsonl + imu_high_rate.jsonl + depth/* と、 a で得た手姿勢を frame index で結合、 LeRobot v3 の `observation.*` / `action` 列に展開した parquet を生成。 action は両手手首 6-DoF (= 14-dim)、 MANO 全体 / 21 keypoint は `observation.*` に保持。

c. **LeRobot v3 dataset 組み立て**
   ぼかし済 MP4 を `videos/observation.images.ego_cam/chunk-000/file-000.mp4` に配置、 meta/info.json に Pipeline 2 で得た root_asset_id / content_hash / signed_json_uri 等を `rootlens.*` 拡張として焼く。

出力: LeRobot v3 dataset へのリンク (= `meta/` `data/` `videos/` 一式)。

#### 冪等性

3 パイプラインともに同じ入力に対して同じ出力を返す。 ぼかし結果は入力 hash をキーにキャッシュ、 Root NFT 発行は同一 content_hash の既発行があれば短絡、 LeRobot dataset 構築も決定論的。 ネットワーク障害や中断からの再実行が安全。

### 6.3 品質スコアの算出と意味

Pipeline 2 の品質評価が用いるメトリックは、 ego-centric 計測の業界共通ベンチに揃える。 具体値は次の通り。

| メトリック | 高品質 (= 満点側に寄与) |
|---|---|
| 1 つ以上の手の出現率 | ≥ 40 % |
| 両手の出現率 | ≥ 30 % |
| いずれかの手の出現率 | ≥ 70 % |
| 深度データの有効率 (= LiDAR 搭載機のみ) | ≥ 80 % |
| RGB / 深度 / IMU の同期率 | ≥ 90 % |
| IMU 重力ベクトルの重力定数からの偏差 | ≤ 0.5 m/s² |
| RGB フレーム欠落数 | 0 個 |

これらメトリックから 0〜100 の総合スコアを算出し、 内訳とともに撮影者・買い手の双方に開示する。

**棄却閾値は設けない**。 スコアが低くてもクリップは「準備完了」 に進み、 ステーキング可能になる。 買い手はスコアでフィルタすることで自身の用途に合うクリップだけを選ぶ。 撮影者は自身のクリップのスコアと内訳を見ることで、 次回以降の撮り方を自発的に改善できる。

この基準値は、 需要側 AI 企業の要件が固まった段階で見直す。 見直し履歴は本節の改訂履歴として記録する。

### 6.4 販売条件と価格決定

License NFT の販売価格は、 RootLens がオフチェーンで決定する。 RootLens は、 タスク種別・デバイスメタデータ・品質スコアなどに基づく価格表を管理し、 AI 企業に公開する。 AI 企業との個別交渉による価格設定も行う。

AI 企業には、 タスクの種類、 デバイスのメタデータ (プラットフォーム、 デバイスモデル、 センサー構成)、 §6.3 の品質スコアと内訳などを提示し、 購入判断の材料とする。 技術検証用のサンプルデータの提供も行う。

販売の実行は §5.3 の co-sign フローに従う。 RootLens のサーバーは、 co-sign の前に、 当該 root_mint が自社に delegate されていること、 および price が事前に設定された許容価格以上であることを検証する。 許容価格を下回るトランザクションは拒否される。

価格決定のロジックはオフチェーンで管理される。 オンチェーンに記録されるのは、 実際に実行された取引の price のみである。 バルク購入 (複数の License NFT を一括で購入) の場合は、 個別交渉による価格設定の上、 複数の issue_license トランザクションをバッチで実行する。

### 6.5 TDM オプトアウトの埋め込み

RootLens の公開ページおよび API レスポンスには、機械可読な TDM オプトアウトシグナルを付与する。これにより、RootLens に登録されたコンテンツは EU 著作権指令 Article 4(3) の下で明示的にオプトアウトされた著作物となり、無断でスクレイピングして AI 学習に使用した事業者は、EU AI Act Article 53(1)(c) に基づく違反リスクを負う。ライセンスを正規に購入することで、このリスクが解消される。

---

## 7. 権利の流れの全体像

権利の流れを整理すると、 以下のようになる。

1. **撮影者が動画を撮影する。** 撮影者は動画の著作権を原始的に取得する。
2. **撮影者がアプリ利用規約に同意する。** 利用規約に基づき、 撮影者は delegate へのサブライセンス権を付与する (§4.4)。
3. **撮影者が「送る」 を選び、 MCAP がサーバへアップロードされる (§2.8)。** クライアントはここで責務を終える。 以降の処理はサーバが担う。
4. **サーバ側パイプラインが実行される (§6.2)。** C2PA 署名検証、 顔ぼかし、 品質評価、 TP 登録と R2 配置を順に実行する。 TP が C2PA 署名を検証し、 Root NFT (cNFT) が発行される。 Root NFT はコンテンツの ID であり、 ライセンス発行権の「鍵」 である。
5. **クリップが「準備完了」 状態になり、 撮影者に通知される (§2.9)。** 品質評価が公開基準を下回った場合は「不合格」 状態となり、 ステーキングには進めない。
6. **撮影者がステーキング画面でぼかし内容と品質を確認し、 delegate を RootLens に設定する (§4.2)。** RootLens は §4.4 の著作権利用許諾に基づくサブライセンス権を行使可能になる。 撮影者は Root NFT の所有権と著作権を保持し続ける。
7. **AI 企業が License NFT を購入する。** AI 企業が issue_license トランザクションを構築・署名し、 RootLens が co-sign する。 License NFT が AI 企業に直接発行され、 支払いと収益分配がアトミックに完了する。
8. **AI 企業がデータを利用する。** License NFT の保有者は、 ライセンス条文に定められた範囲でデータを利用できる。 ライセンスの存在はオンチェーンで第三者が検証可能である。
9. **撮影者が収益を引き出す。** ステーカーは claim_revenue() を呼び出し、 すべての Root NFT から累積した未分配収益を一括で自分のウォレットに引き出す。
10. **(任意) 撮影者がアンステークする。** Root NFT の delegate を解除する。 以降、 この Root NFT に対する新規 License NFT の発行は停止する。 既発行の License NFT に基づく許諾は、 ライセンス条文に定められた期間中存続する。

---

## 8. オンチェーンアカウント構造

| アカウント | 個数 | 用途 |
| --- | --- | --- |
| Root NFT（cNFT） | 動画ごとに 1 個 | コンテンツ ID、delegate 情報（Bubblegum Merkle Tree 内） |
| License NFT（cNFT） | 発行ごとに 1 個 | ライセンスの証明（Bubblegum Merkle Tree 内） |
| ユーザー収益アカウント（PDA） | ユーザー 1 人につき 1 個 | 累積収益残高 |
| プログラム USDC プール（PDA） | 1 個 | 全 USDC をプール |

動画ごとの PDA は存在しない。Root NFT と License NFT はいずれも cNFT であり、Bubblegum の Merkle Tree 内に圧縮格納される。追加のオンチェーンコストは、ユーザー 1 人につき 1 個の収益アカウント PDA（約 $0.13、初回 issue_license 時に購入者負担で作成）のみである。

---

## 9. データの置き場所

| 置き場 | 中身 | アクセス |
| --- | --- | --- |
| Solana | Root NFT（cNFT）、License NFT（cNFT）、ユーザー収益アカウント、USDC プール | 公開。RPC / DAS API で誰でも読める |
| R2 | 動画データ（プライバシー処理済み）、NFT のオフチェーンメタデータ（ライセンス条文ハッシュ等を含む JSON）、ライセンス条文本体 | 動画データは RootLens 経由のみ。メタデータ JSON とライセンス条文は公開 |
| RootLens DB（Supabase） | タスク定義、VLM スコア、ユーザー情報、デバイスメタデータ、処理パイプラインの結果、ライセンス発行記録、外部 KYC サービスのリファレンス | RootLens サーバー経由のみ |

---

## 10. KYC

供給者（撮影・アップロードを行うユーザー）は、最初のアップロード前に KYC を完了する必要がある。

KYC の実装は第三者の KYC サービス（Sumsub 等）に委託する。必要な情報項目と保持期間は、適用される法令に準拠したサービスを選定する。RootLens は独自に KYC の仕組みを実装しない。

---

## 11. 既知のリスクと信頼前提

### 11.1 データの直接引渡しリスク

動画データは RootLens の R2 に保存されており、RootLens はデータの管理者である。RootLens が AI 企業にデータを直接引き渡し、issue_license を実行しなければ、ステーカーへの収益還元がバイパスされる可能性がある。オンチェーンの仕組みではこれを防げない。

ただし、EU AI Act の規制環境下では、ライセンスなしのデータを使用する AI 企業は規制リスクを負う。License NFT はコンプライアンスの証明として機能するため、正規のライセンスを持たないデータの利用価値は低い。RootLens の評判インセンティブと合わせて、この信頼前提は実用上十分に機能すると判断する。

### 11.2 ライセンスの非排他性

本仕様では、すべてのライセンスを非排他（non-exclusive）とする。一つの Root NFT に対して複数の License NFT が発行されうる。排他ライセンス（exclusive license）は提供しない。AI 企業がデータの独占利用を求める場合は、契約上の取り決め（オフチェーン）で対応する。

### 11.3 RootLens の事業継続性 (= 解散時の取扱)

RootLens 自体が事業継続不能となった場合の取扱を明示する必要がある (= 買い手の信頼確保 + 撮影者の継続的な収益機会の保護)。

#### 既発行 License NFT

ブロックチェーン上の不変な記録として永続する。 保有者は RootLens の存続有無に関わらず、 当該 License NFT に紐づくライセンス文書で定められた利用権を保有し続ける (= 著作権者である撮影者の一方的許諾こそが法的根拠であり、 RootLens は仲介者にすぎないため)。

#### 既発行 License NFT に対する補償義務

RootLens 解散後は実務的に履行不能となる。 個別契約 (= enterprise contract) を締結している買い手向けには、 補償義務の継承先確保 (= 後継主体への譲渡、 または保険による補填) を別途約定する。

#### 代理人 (delegate) の権限の継承

撮影者が代理人として指定している RootLens 運営アカウントは、 解散後は新規 License NFT 発行に共同署名できなくなる。 撮影者は自身のウォレットから直接 stake を解除し、 別の代理人に再設定できる (= ブロックチェーン上の Bubblegum 標準機能、 RootLens の協力不要)。

#### 継承計画

解散発生時、 RootLens は撮影者・既発行 License NFT 保有者に対し、 60 日以上前の事前通知と、 代理人の権限の継承候補先の提示 (= 後継サービス提供者、 DAO 化、 撮影者本人による self-delegate 等の選択肢) を提供する義務を負う旨を、 利用規約・販売規約に明記する。

---

## 12. データ削除と GDPR

ユーザーからデータの削除要求があった場合、RootLens は R2 上の動画データを削除する。オンチェーンの Root NFT と License NFT はイミュータブルであり削除できないが、対応する動画データが削除されるため、ライセンスの実質的な利用価値は消滅する。オンチェーンの記録は残るが、データ本体が存在しないため、プライバシーリスクは解消される。