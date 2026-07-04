// 環境変数の集約レイヤ。 アプリ全体で `process.env.EXPO_PUBLIC_*` を散発的に
// 読まず、 ここの export 経由で取得する。
//
// 設計方針:
//   • 「無くてもアプリが起動できる」 ものはデフォルト値を与える (= Solana 公式 RPC など)
//   • 「無いと致命的」 なものは require() で読み、 起動時に Error を投げる
//   • debug 用 (= debug wallet、 buyer simulator) は optional で undefined を返す
//
// .env.example も本ファイルと 1:1 で対応させること。

// ⚠ Expo は **静的な** `process.env.EXPO_PUBLIC_XXX`（リテラルのプロパティ参照）だけを
//    ビルド時にインライン化する。 `process.env[変数]` のような動的アクセスは置換されず、
//    リリースビルドでは undefined になる (= dev では Metro が実行時 env を注入するので動くが、
//    TestFlight / 本番では env.* が全部 undefined → readRequired が起動時に throw して即クラッシュ)。
//    そこで全 EXPO_PUBLIC_ キーを「静的アクセスで」一度オブジェクトに集約し、 以降はそこから読む。
const ENV: Record<string, string | undefined> = {
  EXPO_PUBLIC_USE_SANDBOX: process.env.EXPO_PUBLIC_USE_SANDBOX,
  EXPO_PUBLIC_SOLANA_RPC_URL: process.env.EXPO_PUBLIC_SOLANA_RPC_URL,
  EXPO_PUBLIC_SOLANA_NETWORK: process.env.EXPO_PUBLIC_SOLANA_NETWORK,
  EXPO_PUBLIC_SERVER_URL: process.env.EXPO_PUBLIC_SERVER_URL,
  EXPO_PUBLIC_TP_GATEWAY_ENDPOINT: process.env.EXPO_PUBLIC_TP_GATEWAY_ENDPOINT,
  EXPO_PUBLIC_COSIGN_AUTHORITY: process.env.EXPO_PUBLIC_COSIGN_AUTHORITY,
  EXPO_PUBLIC_MERKLE_TREE: process.env.EXPO_PUBLIC_MERKLE_TREE,
  EXPO_PUBLIC_MERKLE_COLLECTION: process.env.EXPO_PUBLIC_MERKLE_COLLECTION,
  EXPO_PUBLIC_DEBUG_WALLET_BASE58: process.env.EXPO_PUBLIC_DEBUG_WALLET_BASE58,
  EXPO_PUBLIC_BUYER_WALLET_ADDRESS: process.env.EXPO_PUBLIC_BUYER_WALLET_ADDRESS,
  EXPO_PUBLIC_BUYER_KEYPAIR_BASE58: process.env.EXPO_PUBLIC_BUYER_KEYPAIR_BASE58,
};

function readOptional(key: string): string | undefined {
  const v = ENV[key];
  return v && v.length > 0 ? v : undefined;
}

function readRequired(key: string): string {
  const v = readOptional(key);
  if (!v) throw new Error(`${key} is required (set in app/.env)`);
  return v;
}

// ─── 開発: 起点切替 ───────────────────────────────────────────────────────
// 既定は本番 UI (RootNavigator)。 EXPO_PUBLIC_USE_SANDBOX=1 の時だけ DevSandbox を起点にする。
// DevSandbox は dataflow 層の単体検証ハーネスとして温存する (= 削除しない)。
// ⚠ EXPO_PUBLIC_* は build 時に inline されるため、 値変更には rebuild が要る。
export const USE_DEV_SANDBOX = readOptional('EXPO_PUBLIC_USE_SANDBOX') === '1';

// ─── Solana ─────────────────────────────────────────────────────────────
// 公式 devnet RPC は DAS API (= getAssetsByOwner / getAssetsByGroup) も同居で提供する
// ので、 アプリ全体で 1 URL に統合。 専用 RPC (= Helius) を使う場合だけ env で上書き。

export const SOLANA_RPC_URL =
  readOptional('EXPO_PUBLIC_SOLANA_RPC_URL') ?? 'https://api.devnet.solana.com';

// cNFT 発行先ネットワーク (= "devnet" | "mainnet")。 clip の重複排除キーの一部として
// server に送る + mint 前冪等チェックの lookup 条件にする。
// 明示 env を優先し、 無ければ RPC URL から推定 (= mainnet を含むなら mainnet、 それ以外 devnet)。
export type SolanaNetwork = 'devnet' | 'mainnet';
export const SOLANA_NETWORK: SolanaNetwork = ((): SolanaNetwork => {
  const explicit = readOptional('EXPO_PUBLIC_SOLANA_NETWORK');
  if (explicit === 'mainnet' || explicit === 'devnet') return explicit;
  return /mainnet/i.test(SOLANA_RPC_URL) ? 'mainnet' : 'devnet';
})();

// ─── rootlens-server ────────────────────────────────────────────────────
// /api/clips, /api/clips/:id, /api/v1/* など全 server エンドポイントの base。
// デフォルトで本番 (rootlens.io) を指す。 local dev で別ホストを使う場合だけ env 上書き。

export const SERVER_URL =
  readOptional('EXPO_PUBLIC_SERVER_URL') ?? 'https://www.rootlens.io';

// ─── Title Protocol Gateway ─────────────────────────────────────────────
// ⚠ 本流 (dataflow/steps/titleProtocol.ts) は web proxy (/api/v1/tp-*) 経由なので gateway を直叩き
//    しない。 これは legacy / DevSandbox の直叩き経路用。 IP はハードコードしない (= EC2 再起動で
//    変わるため)。 直叩きするなら EXPO_PUBLIC_TP_GATEWAY_ENDPOINT を設定する。
export const TP_GATEWAY_URL = readOptional('EXPO_PUBLIC_TP_GATEWAY_ENDPOINT') ?? '';

// ─── (撤去済) Anthropic API key ─────────────────────────────────────────
// 旧 VLM gate (撮影 Step 2/6 で Claude 直叩き) 用だったが、 2026-05-27 にジェスチャー式へ
// 作り替えて VLM gate を撤去済み。 現在どこからも使われていない。
// ⚠ EXPO_PUBLIC_* は client バンドルに inline されるため、 秘密鍵をここで必須にすると
//    出荷ビルドの IPA から漏洩する。 未使用なので export ごと撤去した (= EXPO_PUBLIC_ANTHROPIC_API_KEY
//    は EAS env / 出荷ビルドに載せない)。

// ─── Solana onchain config ──────────────────────────────────────────────
// RootLens 運営側のオンチェーン pubkey 群。 必須。

// v0.1.4: 後段 (TP / mint) は dataflow から外したので optional に降格。
// 値は EAS env に残っていても無視される。 v0.1.5 で後段ワーカーが復活する時に再利用する。
export const COSIGN_AUTHORITY = readOptional('EXPO_PUBLIC_COSIGN_AUTHORITY') ?? '';
export const MERKLE_TREE = readOptional('EXPO_PUBLIC_MERKLE_TREE') ?? '';
export const MERKLE_COLLECTION = readOptional('EXPO_PUBLIC_MERKLE_COLLECTION');

// ─── Debug only ─────────────────────────────────────────────────────────
// DebugAuthProvider の wallet を env で固定するための optional override。
// 未設定なら SecureStore から復元 or 新規生成する。

export const DEBUG_WALLET_BASE58 = readOptional('EXPO_PUBLIC_DEBUG_WALLET_BASE58');

// Buyer simulator (BuyerScreen のみ使用)。 セット時のみ BuyerScreen が動作。
export const BUYER_WALLET_ADDRESS = readOptional('EXPO_PUBLIC_BUYER_WALLET_ADDRESS');
export const BUYER_KEYPAIR_BASE58 = readOptional('EXPO_PUBLIC_BUYER_KEYPAIR_BASE58');
