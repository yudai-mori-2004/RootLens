/**
 * 仕様書 §7.4 クライアントサイド検証
 *
 * コレクションアドレスはオンチェーンの globalConfig から毎回取得する。
 * ハードコードやキャッシュは使わない。クライアントが直接オンチェーンデータを
 * 参照することで、サーバーに依存しない検証の信頼チェーンを維持する。
 */

import { fetchGlobalConfig, findGlobalConfigPDA, TITLE_CONFIG_PROGRAM_ID, type TrustedTeeNode, type WasmModuleInfo, type WasmVersionInfo } from '@title-protocol/sdk';
import { Connection } from '@solana/web3.js';

/** Solana JSON-RPC エンドポイント (= DAS API も同 URL で提供される) */
export const SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL!;

/** PDQ照合の閾値 (ハミング距離, 256bit空間)
 * DCT計算はTEEと同一のWASMバイナリで実行。
 * Jaroszダウンサンプリングも同一Rustソースからビルドしたjarosz.wasmで実行。
 * Meta PDQの推奨閾値: 31 (類似判定) 。RootLensでは同一コンテンツの再エンコード差のみを
 * 許容するため、より厳しい閾値を使用。 */
export const PDQ_THRESHOLD = 31;

/** プロトコル定数（PDA導出で動的に取得） */
export function getProtocolAddresses() {
  const programId = TITLE_CONFIG_PROGRAM_ID.toBase58();
  const [globalConfigPda] = findGlobalConfigPDA();
  return {
    programId,
    globalConfigPda: globalConfigPda.toBase58(),
  };
}

/** GlobalConfig の全フィールドをオンチェーンから取得 */
export interface GlobalConfigData {
  authority: string;
  core: string;
  ext: string;
  trustedTeeNodes: TrustedTeeNode[];
  trustedTsaKeys: string[];
  trustedWasmModules: WasmModuleInfo[];
}

export type { TrustedTeeNode, WasmModuleInfo, WasmVersionInfo };

export async function getGlobalConfigData(): Promise<GlobalConfigData> {
  const connection = new Connection(SOLANA_RPC_URL);
  const config = await fetchGlobalConfig(connection, 'devnet');

  return {
    authority: config.authority,
    core: config.core_collection_mint,
    ext: config.ext_collection_mint,
    trustedTeeNodes: config.trusted_tee_nodes ?? [],
    trustedTsaKeys: config.trusted_tsa_keys ?? [],
    trustedWasmModules: config.trusted_wasm_modules ?? [],
  };
}

/**
 * wasm_hashからWASMバージョン情報を検索する。
 * NFTに記録されたwasm_hashに一致するバージョンを全モジュールから探す。
 */
export function findWasmVersionByHash(
  modules: WasmModuleInfo[],
  extensionId: string,
  wasmHash: string,
): WasmVersionInfo | null {
  const mod = modules.find(m => m.extension_id === extensionId);
  if (!mod) return null;
  const normalized = wasmHash.replace(/^0x/, "");
  return mod.versions.find(v => v.wasm_hash.replace(/^0x/, "") === normalized) ?? null;
}

/** @deprecated getCollectionMints — getGlobalConfigData を使用 */
export async function getCollectionMints(): Promise<{ core: string; ext: string }> {
  const data = await getGlobalConfigData();
  return { core: data.core, ext: data.ext };
}
