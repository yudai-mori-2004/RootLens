# 10. 横持ちエディトリアルデザイン (= 右レール + 誌面レイアウト)

## 目的

横持ち前提の UI を「モダンで無駄のない、 スタイリッシュ」 に作り替える。 実機 (USB + Metro) の
スクリーンショットを取りながら自己反復でデザインを検証した (= pymobiledevice3 --userspace)。

## デザイン言語 (= 既存 "Editorial Fintech" を横持ちで先鋭化)

- **右レール ナビ**: 下タブ廃止 → 画面右端の縦レール (幅 86)。 マイビデオ / 撮影 (中央ヒーロー =
  ink の丸シャッター + emerald ドット) / 設定。 react-navigation bottom-tabs は削除し、
  自前 row レイアウト + useState (= 2 画面 + 1 アクションに navigator は過剰)。
- **マイビデオ = 誌面見開き**: 左 236pt の扉カラム (日付 labelSmall / あいさつ Fraunces 34 /
  hairline / 待ち本数の Fraunces 72 ヒーロー数字) + 右 2 カラムの写真主体カードグリッド。
- **カード = 写真ファースト**: 16:9 サムネ全幅 + 状態チップ (左上、 ink/danger の小 caps) +
  尺タグ (右下 mono) + Fraunces セリフ題字 + メタ 1 行。 uploading はサムネ下端 3px 進捗バー
  (確定 % / 不確定アニメ)、 error は danger チップ + 平易文 + 「もう一度試す (ink pill) / 削除」。
- **プレビューポップ**: 左 = 動画 16:9 (高さがシート高を決める)、 右 = emerald の caps 見出し
  「アップロード前の確認」 + セリフ題字 + hairline + 確認文 + emerald 全幅ボタン + 削除/閉じる。
- **設定**: maxWidth 980 + 明示 2 カラム (左 = 言語/アカウント/サポート、 右 = 撮影/データ/
  アプリ情報/DEVELOPER)。 placeholder 行 (プッシュ通知 / ハンドトラッキング) は残骸として撤去。

## 検証済みパターン (= 実機スクショ)

recorded (サムネあり/なし) / uploading (62% + 不確定) / error (長文 2 行 ellipsis + アクション) /
空状態 (セリフ大見出し + 0 カウンタ) / 設定 2 カラム / プレビューポップ / レール active 状態。

## 実装メモ

- デザイン検証モック: CollectionScreen の `DESIGN_PREVIEW` フラグ (= __DEV__ && false でコミット)。
  store / 永続化を汚さず表示だけに合成する。 サムネは assets/decor を previewSource で上書き。
- 実機スクショ: `pymobiledevice3 developer dvt screenshot out.png --userspace` (iOS 26 + USB、
  root 不要)。 Metro のフルリロードは `curl http://localhost:8081/reload`。
- 文言: 「中央のカメラボタン」 → 「右の丸いボタン」 (= レール移動に追随)。
  設定の subtitle 「フィジカル AI 訓練データ市場」 → 「アカウントとアプリの設定」 (= 現状に一致)。

## 進捗

- [x] 右レール (MainTabs 自前化、 bottom-tabs 削除)
- [x] マイビデオ誌面レイアウト + 写真ファーストカード (全状態)
- [x] プレビューポップ再設計
- [x] 設定 2 カラム + placeholder 撤去
- [x] 実機スクショで全パターン検証 (v1〜v8)
- [ ] ユーザーレビュー (= 実機で触った感触)
