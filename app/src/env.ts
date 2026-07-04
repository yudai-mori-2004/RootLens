// 環境変数の集約レイヤ。 アプリ全体で `process.env.EXPO_PUBLIC_*` を散発的に
// 読まず、 ここの export 経由で取得する。
//
// 設計方針:
//   • 「無くてもアプリが起動できる」 ものはデフォルト値を与える
//   • debug 用は optional で undefined を返す
//
// .env.example も本ファイルと 1:1 で対応させること。

// ⚠ Expo は **静的な** `process.env.EXPO_PUBLIC_XXX`（リテラルのプロパティ参照）だけを
//    ビルド時にインライン化する。 `process.env[変数]` のような動的アクセスは置換されず、
//    リリースビルドでは undefined になる (= dev では Metro が実行時 env を注入するので動くが、
//    TestFlight / 本番では env.* が全部 undefined になる)。
//    そこで全 EXPO_PUBLIC_ キーを「静的アクセスで」一度オブジェクトに集約し、 以降はそこから読む。
const ENV: Record<string, string | undefined> = {
  EXPO_PUBLIC_USE_SANDBOX: process.env.EXPO_PUBLIC_USE_SANDBOX,
  EXPO_PUBLIC_SERVER_URL: process.env.EXPO_PUBLIC_SERVER_URL,
  EXPO_PUBLIC_DEBUG_ACCOUNT_BASE58: process.env.EXPO_PUBLIC_DEBUG_ACCOUNT_BASE58,
};

function readOptional(key: string): string | undefined {
  const v = ENV[key];
  return v && v.length > 0 ? v : undefined;
}

// ─── 開発: 起点切替 ───────────────────────────────────────────────────────
// 既定は本番 UI (RootNavigator)。 EXPO_PUBLIC_USE_SANDBOX=1 の時だけ DevSandbox を起点にする。
// DevSandbox は dataflow 層の単体検証ハーネスとして温存する (= 削除しない)。
// ⚠ EXPO_PUBLIC_* は build 時に inline されるため、 値変更には rebuild が要る。
export const USE_DEV_SANDBOX = readOptional('EXPO_PUBLIC_USE_SANDBOX') === '1';

// ─── rootlens-server ────────────────────────────────────────────────────
// /api/clips, /api/v1/* など全 server エンドポイントの base。
// デフォルトで本番 (rootlens.io) を指す。 local dev で別ホストを使う場合だけ env 上書き。

export const SERVER_URL =
  readOptional('EXPO_PUBLIC_SERVER_URL') ?? 'https://www.rootlens.io';

// ─── Debug only ─────────────────────────────────────────────────────────
// DebugAuthProvider のアカウント鍵を env で固定するための optional override
// (= 64 byte base58 secret)。 未設定なら SecureStore から復元 or 新規生成する。

export const DEBUG_ACCOUNT_BASE58 = readOptional('EXPO_PUBLIC_DEBUG_ACCOUNT_BASE58');
