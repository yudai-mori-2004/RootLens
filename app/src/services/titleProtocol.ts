// Title Protocol 登録 — 仕様書 §6.1 パイプラインA
// 実行主体: アプリ (Title Protocol SDK)
// delegateMint: true で Gateway が Solana TX broadcast + signed_json 保存を委譲

import {
  fetchGlobalConfig,
  TitleClient,
  decryptResponse,
} from '@title-protocol/sdk';
import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { Connection } from '@solana/web3.js';
import * as FileSystem from 'expo-file-system';
import { AesGcmBridge, nativeCryptoProvider } from './nativeCryptoProvider';
import { SOLANA_RPC_URL, TP_GATEWAY_URL } from '../env';

// iOS app から TP gateway (plain HTTP) に直 fetch すると iOS 26.x で
// "Network request failed" になる (ATS=arbitrary loads でも IP literal + plain HTTP
// が block される)。Vercel HTTPS proxy 経由で叩く。
// 動画 blob 本体は presigned URL で直接 S3 (HTTPS) に PUT するので proxy しない。
import { config } from '../config';
const TP_PROXY_BASE = `${config.serverUrl}/api/v1/tp-proxy`;

/**
 * Vercel HTTPS proxy 経由で TP gateway を叩く。
 * SDK の gatewayPost を完全 bypass。
 * proxy route: web/app/api/v1/tp-proxy/[...path]/route.ts
 */
async function gatewayPostDirect<T>(
  gatewayUrl: string,
  path: string,
  body: unknown,
): Promise<T> {
  // path は "/upload-url" 等。proxy も同じ subpath を expect する。
  const subpath = path.replace(/^\//, '');
  const proxyUrl = `${TP_PROXY_BASE}/${subpath}`;
  let res: Response;
  try {
    res = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // proxy 側で whitelist 内なら header 経由で gateway 切替可能
        'X-TP-Gateway': gatewayUrl.replace(/\/$/, ''),
      },
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    throw new Error(`[TP proxy] POST ${proxyUrl} failed: ${e?.message ?? e}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(`[TP proxy] ${subpath} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export interface TitleProtocolResult {
  contentHash: string;
  txSignature: string;
}

// ---------------------------------------------------------------------------
// Extension 選択 — ガバナンス定義に基づく processor_ids 構築
// ---------------------------------------------------------------------------

/** C2PA 署名者の signer_org に基づいて適用可能な cert extension を判定 */
const CERT_EXTENSION_MAP: { id: string; matchSignerOrg: string }[] = [
  { id: 'cert-rootlens', matchSignerOrg: 'RootLens' },
  { id: 'cert-google',   matchSignerOrg: 'Google' },
  { id: 'cert-sony',     matchSignerOrg: 'Sony' },
  { id: 'cert-leica',    matchSignerOrg: 'Leica' },
];

function buildProcessorIds(signerOrg: string, mediaType: 'image' | 'video'): string[] {
  const ids: string[] = ['core-c2pa'];
  const certMatch = CERT_EXTENSION_MAP.find((e) => signerOrg.includes(e.matchSignerOrg));
  if (certMatch) ids.push(certMatch.id);
  ids.push(mediaType === 'video' ? 'video-vpdq' : 'image-pdq');
  return ids;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// HKDF 方向別鍵導出 — Rust sealed_channel::derive_keys() と同一パラメータ
// ---------------------------------------------------------------------------

function deriveDirectionalKeys(
  sharedSecret: Uint8Array,
  encapKey: Uint8Array,
): { requestKey: Uint8Array; responseKey: Uint8Array } {
  const requestKey  = hkdf(sha256, sharedSecret, encapKey, 'title-request-key',  32);
  const responseKey = hkdf(sha256, sharedSecret, encapKey, 'title-response-key', 32);
  return { requestKey, responseKey };
}

/**
 * Title Protocol にコンテンツを登録する (ファイルパスベース)。
 *
 * ECDH + HKDF は JS (@noble/curves, 32B 鍵演算で十分速い)。
 * AES-256-GCM 暗号化はネイティブ (CryptoKit / javax.crypto, ファイルパス方式で大容量対応)。
 * 5MB のコンテンツが JS ↔ Native bridge を一切通過しない。
 */
export async function registerOnTitleProtocol(
  contentFilePath: string,
  ownerWallet: string,
  signerOrg: string = 'RootLens',
  mediaType: 'image' | 'video' = 'video',
): Promise<TitleProtocolResult> {
  const t0 = Date.now();
  const lap = (l: string) => console.log(`[TP] ${l}: ${Date.now() - t0}ms`);

  lap('fetchGlobalConfig start');
  const connection = new Connection(SOLANA_RPC_URL);
  const globalConfig = await fetchGlobalConfig(connection, 'devnet');
  lap('fetchGlobalConfig done');

  const client = new TitleClient(globalConfig, { crypto: nativeCryptoProvider });

  // SDK の selectNode() は Promise.any + AbortController で health check するが、
  // iOS の Hermes / RN fetch では何故か silent に hang して "No healthy TEE node found"
  // で fail する (Mac/web では OK)。on-chain の trusted_tee_nodes から直接 1 件取って
  // TeeSession 形に組み立てて bypass する。Health check 不要なら EXPO_PUBLIC_TP_GATEWAY_ENDPOINT
  // で endpoint を強制 pin することも可能。
  const teeNodes = client.getTrustedTeeNodes();
  if (teeNodes.length === 0) throw new Error('No TEE nodes registered on-chain');
  const pinned = TP_GATEWAY_URL.replace(/\/$/, '');
  const picked =
    teeNodes.find((n) => n.gateway_endpoint.replace(/\/$/, '') === pinned) ?? teeNodes[0];
  if (!picked) throw new Error(`No TEE node found (pinned=${pinned})`);
  const node = {
    gatewayUrl: picked.gateway_endpoint.replace(/\/$/, ''),
    encryptionPubkey: picked.encryption_pubkey,
    signingPubkey: picked.signing_pubkey,
  };
  lap(`node picked (bypass health-check): ${node.gatewayUrl}`);

  // KEM: X25519 ECDH (JS)
  const teeEncPubkey = nativeCryptoProvider.fromBase64(node.encryptionPubkey);
  const ephSecretKey = x25519.utils.randomPrivateKey();
  const ephPublicKey = x25519.getPublicKey(ephSecretKey);
  const sharedSecret = x25519.getSharedSecret(ephSecretKey, teeEncPubkey);

  // KDF: 方向別鍵導出
  const { requestKey, responseKey } = deriveDirectionalKeys(sharedSecret, ephPublicKey);
  lap('ECDH+HKDF done');

  // ネイティブで暗号化 (コンテンツが Bridge を通過しない)。
  // 新ワイヤーフォーマット: [suite_id(1B)][encap_key_len(2B BE)][encap_key][nonce][ct]
  const payloadPath = `${FileSystem.cacheDirectory}tp_payload_${Date.now()}.bin`.replace('file://', '');
  const contentPath = contentFilePath.replace('file://', '');
  const metadata = JSON.stringify({ owner_wallet: ownerWallet });
  const aad = '/verify';

  const encryptResult = await AesGcmBridge.buildAndEncryptPayload(
    contentPath,
    metadata,
    toBase64(requestKey),
    toBase64(ephPublicKey),
    aad,
    payloadPath,
  );
  console.log('[TP encrypt] reported size:', encryptResult?.size, 'path:', payloadPath);
  lap('native encrypt done');

  // Upload (ファイルから直接送信)
  const fileInfo = await FileSystem.getInfoAsync(`file://${payloadPath}`);
  const payloadSize = (fileInfo as any).size || 0;
  console.log('[TP encrypt] on-disk size:', payloadSize, 'exists:', fileInfo.exists);
  if (payloadSize < 64) {
    throw new Error(`[TP encrypt] payload size suspiciously small (${payloadSize} bytes) — encrypt likely failed`);
  }

  // SDK の gatewayPost は new URL(path, base) を使ってて iOS で詰まるケースが報告された。
  // 直 fetch で gateway を叩く helper を使う。
  const upload = await gatewayPostDirect<{
    upload_url: string;
    download_url: string;
    expires_at?: number;
  }>(node.gatewayUrl, '/upload-url', {
    content_size: payloadSize,
    content_type: 'application/octet-stream',
  });
  const uploadUrl = upload.upload_url;
  const downloadUrl = upload.download_url;
  lap('getUploadUrl done');

  const uploadResp = await FileSystem.uploadAsync(uploadUrl, `file://${payloadPath}`, {
    httpMethod: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
  });
  console.log('[TP upload] S3 status=', uploadResp.status, 'body_len=', uploadResp.body?.length ?? 0);
  if (uploadResp.status < 200 || uploadResp.status >= 300) {
    throw new Error(`[TP upload] S3 PUT failed: HTTP ${uploadResp.status} body=${(uploadResp.body ?? '').slice(0, 300)}`);
  }
  lap('upload done');

  // Sanity check: GET back from S3, verify byte count matches what we PUT.
  // gateway が "payload too short" を返すのは大抵この段階のサイズ齟齬。
  // HEAD 自体の network 失敗 (= S3 reach できない等) は warning だが、 サイズ齟齬を
  // 検出したら絶対に throw して止める (= silent corruption を放置すると下流の verify が
  // 別の理由で失敗して原因追跡が困難になる)。
  let headLenHdr: string | null = null;
  let headStatus: number | null = null;
  let headOk = false;
  try {
    const verifyHead = await fetch(downloadUrl, { method: 'HEAD' });
    headStatus = verifyHead.status;
    headLenHdr = verifyHead.headers.get('content-length');
    headOk = verifyHead.ok;
    console.log('[TP upload verify] S3 HEAD status=', headStatus, 'content-length=', headLenHdr);
  } catch (e: any) {
    console.warn('[TP upload verify] HEAD network failed (continuing):', e?.message ?? e);
  }
  if (headOk && headLenHdr && Number(headLenHdr) !== payloadSize) {
    throw new Error(
      `[TP upload verify] S3 stored ${headLenHdr} bytes but we PUT ${payloadSize} bytes (status=${headStatus}). upload corrupted.`,
    );
  }

  // verify
  const encryptedResponse = await gatewayPostDirect<{ nonce: string; ciphertext: string; [k: string]: unknown }>(
    node.gatewayUrl,
    '/verify',
    {
      download_url: downloadUrl,
      processor_ids: buildProcessorIds(signerOrg, mediaType),
    },
  );
  lap('verify done');
  // 診断ログ: gateway が encrypted response 形式で返してきてるか確認 (key 漏洩しない範囲で表示)
  console.log('[TP verify resp keys]', Object.keys(encryptedResponse).join(','));
  console.log(
    `[TP verify resp shape] nonce_len=${encryptedResponse.nonce?.length ?? 'null'} ` +
      `ct_len=${encryptedResponse.ciphertext?.length ?? 'null'}`,
  );
  if (!encryptedResponse.nonce || !encryptedResponse.ciphertext) {
    throw new Error(
      `[TP verify] gateway returned non-encrypted body: ${JSON.stringify(encryptedResponse).slice(0, 400)}`,
    );
  }

  // decrypt (レスポンスは小さいので JS CryptoProvider で十分)
  const verifyAad = new TextEncoder().encode(aad);
  console.log(
    `[TP decrypt prep] respKey hex16=${Array.from(responseKey.slice(0, 8)).map((b) => b.toString(16).padStart(2, '0')).join('')} ` +
      `aad_bytes=${verifyAad.length} aad_text="${aad}"`,
  );
  let responsePlaintext: Uint8Array;
  try {
    responsePlaintext = await decryptResponse(
      responseKey,
      encryptedResponse.nonce,
      encryptedResponse.ciphertext,
      verifyAad,
      nativeCryptoProvider,
    );
  } catch (e: any) {
    throw new Error(
      `[TP decrypt failed] ${e?.message ?? e}\n` +
        `respKey_first8_hex=${Array.from(responseKey.slice(0, 8)).map((b) => b.toString(16).padStart(2, '0')).join('')} ` +
        `nonce_b64=${encryptedResponse.nonce} ct_len_b64=${encryptedResponse.ciphertext.length}`,
    );
  }
  const verifyResponse = JSON.parse(new TextDecoder().decode(responsePlaintext));
  lap('decrypt done');

  // sign-and-mint
  const signRequests = verifyResponse.results.map((r: any) => ({
    signed_json: r.signed_json,
  }));
  const mintRes = await gatewayPostDirect<{ tx_signatures: string[] }>(
    node.gatewayUrl,
    '/sign-and-mint',
    {
      recent_blockhash: '',
      requests: signRequests,
    },
  );
  lap('sign-and-mint done');

  // cleanup
  FileSystem.deleteAsync(`file://${payloadPath}`, { idempotent: true });

  const contentHash = verifyResponse.results[0]?.signed_json?.payload?.content_hash || '';
  const txSignature = mintRes.tx_signatures?.[0] || '';

  return { contentHash, txSignature };
}
