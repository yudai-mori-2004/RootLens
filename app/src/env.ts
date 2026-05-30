// 環境変数の集約レイヤ。 アプリ全体で `process.env.EXPO_PUBLIC_*` を散発的に
// 読まず、 ここの export 経由で取得する。
//
// 設計方針:
//   • 「無くてもアプリが起動できる」 ものはデフォルト値を与える (= Solana 公式 RPC など)
//   • 「無いと致命的」 なものは require() で読み、 起動時に Error を投げる
//   • debug 用 (= debug wallet、 buyer simulator) は optional で undefined を返す
//
// .env.example も本ファイルと 1:1 で対応させること。

const ENV = process.env as Record<string, string | undefined>;

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
// 端末から TP /process + /extension/solana を直接叩く URL。 default は v0.1.3 で
// 公開している devnet 用 gateway。

export const TP_GATEWAY_URL =
  readOptional('EXPO_PUBLIC_TP_GATEWAY_ENDPOINT') ?? 'http://13.113.217.17:3000';

// ─── Anthropic (= VLM gate dev-mode 用) ────────────────────────────────
// 撮影シーケンス Step 2 / Step 6 で Claude に直接送る。 server proxy を経由
// する本番 mode に切り替わるまでは必須。

export const ANTHROPIC_API_KEY = readRequired('EXPO_PUBLIC_ANTHROPIC_API_KEY');

// ─── Solana onchain config ──────────────────────────────────────────────
// RootLens 運営側のオンチェーン pubkey 群。 必須。

export const COSIGN_AUTHORITY = readRequired('EXPO_PUBLIC_COSIGN_AUTHORITY');

// Bubblegum cNFT 発行先 merkle tree (= Pipeline 1 step 6 で必要)。
// dev では tests/license-nft/create-smoke-tree.ts で作った public tree を指定。
export const MERKLE_TREE = readRequired('EXPO_PUBLIC_MERKLE_TREE');

// cNFT collection (省略時 collection なしで mint。 public tree なら不要)。
export const MERKLE_COLLECTION = readOptional('EXPO_PUBLIC_MERKLE_COLLECTION');

// ─── Debug only ─────────────────────────────────────────────────────────
// DebugAuthProvider の wallet を env で固定するための optional override。
// 未設定なら SecureStore から復元 or 新規生成する。

export const DEBUG_WALLET_BASE58 = readOptional('EXPO_PUBLIC_DEBUG_WALLET_BASE58');

// Buyer simulator (BuyerScreen のみ使用)。 セット時のみ BuyerScreen が動作。
export const BUYER_WALLET_ADDRESS = readOptional('EXPO_PUBLIC_BUYER_WALLET_ADDRESS');
export const BUYER_KEYPAIR_BASE58 = readOptional('EXPO_PUBLIC_BUYER_KEYPAIR_BASE58');
