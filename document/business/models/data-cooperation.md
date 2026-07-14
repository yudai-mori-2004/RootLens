# data-cooperation モデル

撮影協力型。店舗の既存スタッフがヘッドギアを装着して通常業務を行い、その映像を撮影する。

## 対象

熟練スタッフのいる店舗全般。飲食業の仕込み (パン、和菓子、寿司、居酒屋)、小売の裏方 (品出し・梱包)、工房、軽工場、清掃事業所など。

## 2 つの経路

### direct (直販)

moodai が店主に直接ピッチして契約する。

```
moodaiが還元 1,000円  (moodai → 店へ支払い)
  ├─ スタッフへのボーナス (例: 800円)
  └─ 店の副収入        (例: 200円)
配分は店が自由に決められる。
```

- テンプレ: `templates/data-cooperation/flyer-direct.html`, `agreement-direct.html`

### recruiter (代理店経由)

代理店 (recruiter, 例: サトウカエデ店主) が他店を紹介した際に適用。moodai は店に対し 800円/時 を支払い、200円/時を代理店に別途支払う。

```
moodaiが還元 (総額 1,000円)
  ├─ 紹介元マージン    200円  (moodai → 代理店へ、別合意で直接支払い)
  └─ お店の取り分      800円  (moodai → 店へ、agreement-referral で契約)
        ├─ スタッフへのボーナス (例: 640円)
        └─ 店の副収入        (例: 160円)
```

- テンプレ: `templates/data-cooperation/flyer-referral.html`, `agreement-referral.html`
- 代理店側の合意書: `templates/data-cooperation/referral-commission.html` (moodai ↔ 代理店の契約)

## 現況 (2026-07-14 時点)

- 1店目 (サトウカエデ) を direct で契約予定
- サトウカエデ店主 は recruiter として、箕面〜石橋エリアの他店を紹介する意向 (referral-commission 合意締結予定)

## 撮影同意書

甲店は、撮影対象となるスタッフごとに `templates/shared/recording-consent.html` の同意書を取得し、店で保管する (合意書の別紙扱い)。moodai は原本を受領しない。

## 想定リスク

- スタッフが装着を嫌がる: ボーナス設計と装着デバイスの快適性で解決 (実店舗では既に受け入れ確認済み)
- 撮影中断のリスク: スタッフ本人が装着を止められる (撮影同意書に明記)
- 代理店経由の拡大時、条件バラつき: referral-commission 合意書で共通条件を担保
