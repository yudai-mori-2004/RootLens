# business — 営業運用ドキュメント

撮影協力店を獲得・運用するためのテンプレート (HTML) とビルドスクリプト。実データ (契約済みの店舗情報、押印スキャン、月次入金) は本 repo には置かず、Obsidian vault (`rootlens-vault/RESOURCE_MANAGEMENT/`) 側で管理する。

契約・同意・プライバシーポリシーを主体非依存な形へ育てるための検討ログは [legal-design-notes.md](legal-design-notes.md) にある (保留中)。

## ディレクトリ

```
business/
├── models/                        # ビジネスモデルの経済モデルと対象を書く
│   ├── labor-supply.md            # 労働提供型 (moodai がスタッフを送る)
│   └── data-cooperation.md        # 撮影協力型 (店のスタッフが装着) — 現行アクティブ
├── templates/                     # 印刷物のソースコード (HTML) + ビルド成果物 (PDF)
│   ├── assets/                    # 全モデル共通の画像 (headset.png / rootlens_R.png / qr_rootlens.png)
│   ├── shared/                    # モデル横断のテンプレ
│   │   └── recording-consent.html   # 撮影同意書 (スタッフ本人の同意) (labor-supply / data-cooperation 共通)
│   ├── labor-supply/
│   │   ├── flyer.html             # 店主向けピッチ (A4)
│   │   └── agreement.html         # 店との合意書 (A4 x 2)
│   └── data-cooperation/
│       ├── flyer-direct.html      # 店主向けピッチ (直販)
│       ├── flyer-referral.html   # 店主向けピッチ (代理店経由)
│       ├── agreement-direct.html  # 店との合意書 (直販, 1,000円/時)
│       ├── agreement-referral.html # 店との合意書 (代理店経由, 800円/時)
│       └── referral-commission.html # 代理店との合意書 (200円/時 手数料)
└── build.sh                       # HTML → PDF (chrome headless)
```

## ビルド

```
./build.sh                         # 全 HTML を PDF 化
./build.sh labor-supply            # labor-supply 配下だけ
./build.sh data-cooperation        # data-cooperation 配下だけ
./build.sh shared                  # shared 配下だけ
```

依存: macOS の Google Chrome (`/Applications/Google Chrome.app`)、python3。

## モデル追加時の手順

1. `models/<new-model>.md` を書く (対象、経済モデル、想定リスク、テンプレ一覧)
2. `templates/<new-model>/` を作り、必要な HTML を配置
3. 共通アセットは `templates/assets/` を `../assets/foo.png` で参照
4. 撮影同意書のような横断テンプレは `templates/shared/` に置く
5. `./build.sh <new-model>` でビルド確認

## 実データの置き場 (vault 側)

契約済みの店舗ごとの記録・押印スキャン・月次入金は本 repo に入れず、
`rootlens-vault/RESOURCE_MANAGEMENT/` 配下で管理する:

- `COLLECTION_SITES/<店名>/page.md` — 店の metadata + 契約モデル + 紹介元
- `COLLECTION_SITES/<店名>/signed-agreement.pdf` — 押印スキャン
- `COLLECTION_SITES/<店名>/recording-consents/` — スタッフごとの同意書スキャン
- `PAYMENTS/<YYYY-MM>.md` — 月次の振込ログ

## 使い分けクイックリファレンス

| ピッチする相手 | 使うテンプレ |
|--------------|-------------|
| 店主に直接、moodai の営業として | `data-cooperation/flyer-direct.html` |
| 代理店 (紹介元) が持って回る、他店向け | `data-cooperation/flyer-referral.html` |
| スタッフにヘッドギアをつけて働いてもらう契約 (直販) | `data-cooperation/agreement-direct.html` |
| スタッフにヘッドギアをつけて働いてもらう契約 (代理店経由) | `data-cooperation/agreement-referral.html` |
| 代理店に紹介手数料を払う契約 | `data-cooperation/referral-commission.html` |
| 撮影対象になるスタッフ本人からの同意 | `shared/recording-consent.html` |
