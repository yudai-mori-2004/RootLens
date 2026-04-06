// 仕様書 §6.1 パイプラインA: Title Protocol登録
// 実行主体: アプリ（Title Protocol SDK）
// delegateMint: true でGatewayにTXブロードキャスト + signed_json保存を委譲

import {
  fetchGlobalConfig,
  TitleClient,
  decryptResponse,
} from '@title-protocol/sdk';
import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { Connection } from '@solana/web3.js';
import { NativeModules } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { nativeCryptoProvider } from './nativeCryptoProvider';

const { AesGcmBridge } = NativeModules;

const SOLANA_RPC_URL = 'https://devnet.helius-rpc.com/?api-key=7bdef7b8-8661-4449-840c-aa835168f2b1';

export interface TitleProtocolResult {
  contentHash: string;
  txSignature: string;
}

// ---------------------------------------------------------------------------
// Extension 選択 — ガバナンス定義に基づく processor_ids 構築
// ---------------------------------------------------------------------------

/** C2PA署名者のsigner_orgに基づいて適用可能な cert extension を判定する */
const CERT_EXTENSION_MAP: { id: string; matchSignerOrg: string }[] = [
  { id: 'cert-rootlens', matchSignerOrg: 'RootLens' },
  { id: 'cert-google', matchSignerOrg: 'Google' },
  { id: 'cert-sony', matchSignerOrg: 'Sony' },
  { id: 'cert-leica', matchSignerOrg: 'Leica' },
];

function buildProcessorIds(signerOrg: string, mediaType: 'image' | 'video'): string[] {
  const ids: string[] = ['core-c2pa'];

  // cert extension: signer_org にマッチするものを追加
  const certMatch = CERT_EXTENSION_MAP.find(
    (e) => signerOrg.includes(e.matchSignerOrg),
  );
  if (certMatch) {
    ids.push(certMatch.id);
  }

  // perceptual hash: メディア種別で選択
  ids.push(mediaType === 'video' ? 'video-vpdq' : 'image-pdq');

  return ids;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// HKDF方向別鍵導出 — Rust sealed_channel::derive_keys() と同一パラメータ
// ---------------------------------------------------------------------------

/** HKDF-SHA256で方向別鍵を導出。salt=encapKey, info="title-request-key"/"title-response-key" */
function deriveDirectionalKeys(
  sharedSecret: Uint8Array,
  encapKey: Uint8Array,
): { requestKey: Uint8Array; responseKey: Uint8Array } {
  const requestKey = hkdf(sha256, sharedSecret, encapKey, 'title-request-key', 32);
  const responseKey = hkdf(sha256, sharedSecret, encapKey, 'title-response-key', 32);
  return { requestKey, responseKey };
}

/**
 * Title Protocol にコンテンツを登録する（ファイルパスベース）
 *
 * ECDH + HKDF はJS（@noble/curves, 32B鍵演算で高速）。
 * AES-256-GCM暗号化はネイティブ（javax.crypto, ファイルパス方式で大容量対応）。
 * 5MBのコンテンツがJS↔Native Bridgeを一切通過しない。
 */
export async function registerOnTitleProtocol(
  contentFilePath: string,
  ownerWallet: string,
  signerOrg: string = 'RootLens',
  mediaType: 'image' | 'video' = 'image',
): Promise<TitleProtocolResult> {
  const t0 = Date.now();
  const lap = (l: string) => console.log(`[TP] ${l}: ${Date.now() - t0}ms`);

  lap('fetchGlobalConfig start');
  const connection = new Connection(SOLANA_RPC_URL);
  const globalConfig = await fetchGlobalConfig(connection, 'devnet');
  lap('fetchGlobalConfig done');

  const client = new TitleClient(globalConfig, { crypto: nativeCryptoProvider });

  // ノード選択
  const node = await client.selectNode();
  lap('selectNode done');

  // KEM: X25519 ECDH（32B演算、JSで十分速い）
  const teeEncPubkey = nativeCryptoProvider.fromBase64(node.encryptionPubkey);
  const ephSecretKey = x25519.utils.randomPrivateKey();
  const ephPublicKey = x25519.getPublicKey(ephSecretKey);
  const sharedSecret = x25519.getSharedSecret(ephSecretKey, teeEncPubkey);

  // KDF: 方向別鍵導出（Rust sealed_channel::derive_keys と同一）
  const { requestKey, responseKey } = deriveDirectionalKeys(sharedSecret, ephPublicKey);
  lap('ECDH+HKDF done');

  // ネイティブで暗号化（コンテンツがBridgeを通過しない）
  // 新ワイヤーフォーマット: [suite_id(1B)][encap_key_len(2B BE)][encap_key][nonce][ct]
  const payloadPath = `${FileSystem.cacheDirectory}tp_payload_${Date.now()}.bin`.replace('file://', '');
  const contentPath = contentFilePath.replace('file://', '');
  const metadata = JSON.stringify({ owner_wallet: ownerWallet });
  const aad = '/verify';

  await AesGcmBridge.buildAndEncryptPayload(
    contentPath,
    metadata,
    toBase64(requestKey),
    toBase64(ephPublicKey),
    aad,
    payloadPath,
  );
  lap('native encrypt done');

  // ファイルから直接アップロード
  const fileInfo = await FileSystem.getInfoAsync(`file://${payloadPath}`);
  const payloadSize = (fileInfo as any).size || 0;

  const { uploadUrl, downloadUrl } = await client.getUploadUrl(
    node.gatewayUrl,
    payloadSize,
    'application/octet-stream',
  );
  lap('getUploadUrl done');

  await FileSystem.uploadAsync(uploadUrl, `file://${payloadPath}`, {
    httpMethod: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
  });
  lap('upload done');

  // verify
  const encryptedResponse = await client.verifyRaw(node.gatewayUrl, {
    download_url: downloadUrl,
    processor_ids: buildProcessorIds(signerOrg, mediaType),
  });
  lap('verify done');

  // decrypt（レスポンスは小さいのでJS CryptoProviderで十分）
  const verifyAad = new TextEncoder().encode(aad);
  const responsePlaintext = await decryptResponse(
    responseKey,
    encryptedResponse.nonce,
    encryptedResponse.ciphertext,
    verifyAad,
    nativeCryptoProvider,
  );
  const verifyResponse = JSON.parse(new TextDecoder().decode(responsePlaintext));
  lap('decrypt done');

  // sign-and-mint
  const signRequests = verifyResponse.results.map((r: any) => ({
    signed_json: r.signed_json,
  }));
  const mintRes = await client.signAndMintRaw(node.gatewayUrl, {
    recent_blockhash: '',
    requests: signRequests,
  });
  lap('sign-and-mint done');

  // cleanup
  FileSystem.deleteAsync(`file://${payloadPath}`, { idempotent: true });

  const contentHash = verifyResponse.results[0]?.signed_json?.payload?.content_hash || '';
  const txSignature = mintRes.tx_signatures?.[0] || '';

  return { contentHash, txSignature };
}
