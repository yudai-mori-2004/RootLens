# business — 営業・同意ドキュメント

撮影協力店との基本合意、撮影参加者の個人同意、案件別の説明資料を管理する。正本はすべてMarkdownで、PDFは共通ビルドから生成する。

## 正本と出力

- 正本：`document/business/documents/`
- 画像：`document/business/assets/`
- スタイル：`document/business/styles/`
- PDF出力：`output/pdf/business/`
- 実際の署名・電子同意記録・支払記録：リポジトリ外の管理領域

PDF生成時だけOSの一時ディレクトリにHTMLを作成する。一時HTMLは生成後に削除され、正本や成果物として保持しない。

## ディレクトリ

```text
document/business/
├── assets/                         # 文書で使う画像
├── documents/
│   ├── current/                    # 現在使用する文書
│   │   ├── agreements/             # 店舗・事業所との基本合意
│   │   ├── consents/               # 撮影参加者本人の同意
│   │   └── notices/                # 案件・国別の追加説明
│   └── archive/
│       └── flyers/                 # 過去条件のフライヤー。配布しない
├── models/                         # ビジネスモデルの背景メモ
├── notes/                          # 設計・検討メモ
├── scripts/build.mjs               # Markdown → 一時HTML → PDF
├── styles/                         # レイアウト別の共通CSS
├── package.json
└── README.md

output/pdf/business/
├── current/                        # 現行文書のPDF
└── archive/                        # 過去資料のPDF
```

## 現行文書

| 用途 | Markdown正本 |
|---|---|
| 店舗・事業所との基本合意 | `documents/current/agreements/site-cooperation.md` |
| 撮影参加者本人の同意 | `documents/current/consents/participant-consent.md` |
| 米国にある提供先への追加説明・同意 | `documents/current/notices/foreign-transfer-us.md` |

案件ごとの協力費、提供先、納品条件などは基本合意書に固定せず、案件別の提示・記録で管理する。外国移転を伴う案件では、個人同意に加えて該当国の説明を表示し、その文書版と同意日時を記録する。

## ビルド

```bash
cd document/business
npm ci
npm run build
```

対象を絞る場合は、`documents/` からの相対パスを渡す。

```bash
npm run build -- current
npm run build -- current/consents/participant-consent.md
npm run build -- archive/flyers
```

必要環境：Node.js、npm、macOS版Google Chrome。固定ポートやPythonのローカルサーバは使用しない。

## 文書を追加する

1. `documents/current/` の適切な分類へMarkdownを追加する。
2. front matterで `layout`、`page`、`margin`、`page_numbers` を指定する。
3. 共通画像は、文書から `assets/` への相対パスで参照する。
4. `npm run build -- <対象>` でPDFを生成する。
5. PDFをレンダリングし、全ページの改ページ、欠落、画像、署名欄を目視確認する。

旧フライヤーは現行化せず、冒頭にアーカイブ表示を付けて `documents/archive/flyers/` に保存する。旧合意書や旧運用マニュアルは正本として残さない。

## 電子同意の記録

同意画面では、本人が確認した本文と追加説明を表示し、少なくとも次を改変されにくい形で記録する。

- 同意者を特定する情報
- 勤務先または撮影場所
- 同意日時
- 同意した文書のパスまたは種別と文書版
- 外国移転を伴う場合は、国別説明の文書版と同意結果

店舗ごとの合意、参加者の電子同意、支払記録は本リポジトリへ保存しない。
