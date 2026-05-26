# タスク 11: アプリ骨格 (3 タブ + Privy 認証)

UI_SPECS_JA.md §2.1 の 3 タブ構成をアプリのルートナビゲーションとして実装する。

## 成果物

- フッタータブ 3 つ: ホーム (左)、カメラ (中央)、設定 (右)
- Privy 認証フロー (embedded wallet): ログイン → ウォレット自動作成
- 認証状態に応じた画面切り替え (未認証 → ログイン画面、認証済 → ホームタブ)
- カメラタブ押下で撮影モード (task 14) への遷移口

## 既存資産

- `sandboxes/04-collection-flow` にタブ構造の断片あり
- Privy SDK は `app/package.json` に導入済 (demo-mode bypass あり)

## 実装方針

- Expo Router の `(tabs)` レイアウトを使用
- Privy の `usePrivy()` + `useEmbeddedWallet()` でログイン状態管理
- カメラタブは placeholder (task 14 で本番化)
- ホームタブも placeholder (task 15 で本番化)
- 設定タブは基本構造だけ (task 16 で本番化)

## 完了条件

- アプリ起動 → Privy ログイン → 3 タブ間遷移ができる
- ウォレットアドレスが設定画面に表示される
