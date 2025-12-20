// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// C2PA Server-Side Verification
// フロントエンドと完全に同じロジックでC2PA検証を行う
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { createC2pa } from 'c2pa';
import { createManifestSummary, type C2PASummaryData } from '@rootlens/shared/c2pa/parser';

/**
 * サーバー側でC2PA検証を実行
 * フロントエンドと完全に同じロジックを使用
 *
 * @param fileBuffer - R2からダウンロードしたファイルのBuffer
 * @returns C2PASummaryData - 検証結果
 */
export async function verifyC2PAOnServer(fileBuffer: Buffer): Promise<C2PASummaryData> {
  console.log('🔍 Starting server-side C2PA verification...');

  // C2PAインスタンスを作成（フロントエンドと同じライブラリ）
  const c2pa = await createC2pa({
    wasmSrc: undefined, // Node.js環境ではundefined
  });

  try {
    // BufferをUint8Arrayに変換してC2PAで読み取り
    const uint8Array = new Uint8Array(fileBuffer);

    // Blobライクなオブジェクトを作成（Node.js環境用）
    const fileBlob = {
      arrayBuffer: async () => uint8Array.buffer,
      size: uint8Array.byteLength,
      type: 'application/octet-stream', // C2PAが自動判定
    };

    // C2PA検証実行（フロントエンドと同じメソッド）
    const result = await c2pa.read(fileBlob as any);

    if (!result.manifestStore) {
      throw new Error('C2PA manifest not found');
    }

    console.log('✅ C2PA manifest found');
    console.log(`   Active manifest label: ${result.manifestStore.activeManifest?.label}`);

    // フロントエンドと完全に同じparser関数を使用
    // thumbnailDataUriはサーバー側では不要なのでnullを渡す
    const summary = await createManifestSummary(result.manifestStore, null);

    console.log('✅ Server-side C2PA verification complete');
    console.log(`   Root Signer: ${summary.originalIssuer}`);
    console.log(`   Claim Generator: ${summary.originalClaimGenerator}`);
    console.log(`   Source Type: ${summary.sourceType}`);
    console.log(`   Is Trusted: ${summary.isTrustedRootIssuer}`);
    console.log(`   Is AI Generated: ${summary.activeManifest?.isAIGenerated}`);

    return summary;

  } catch (error) {
    console.error('❌ C2PA verification failed:', error);
    throw new Error(`C2PA検証に失敗しました: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * 検証結果の妥当性チェック
 * - 信頼できるIssuerか
 * - AI生成ではないか
 * - 必要なデータが揃っているか
 */
export function validateC2PAResult(summary: C2PASummaryData): { valid: boolean; reason?: string } {
  // AI生成チェック
  if (summary.activeManifest?.isAIGenerated) {
    return {
      valid: false,
      reason: 'AI生成コンテンツは受け付けられません',
    };
  }

  // Trusted Issuerチェック
  if (!summary.isTrustedRootIssuer) {
    return {
      valid: false,
      reason: `信頼できないIssuerです: ${summary.originalIssuer}`,
    };
  }

  // 必須データチェック
  if (!summary.activeManifest?.dataHash) {
    return {
      valid: false,
      reason: 'C2PA Data Hash (Hard Binding) が見つかりません',
    };
  }

  if (!summary.originalClaimGenerator) {
    return {
      valid: false,
      reason: 'Claim Generator情報が見つかりません',
    };
  }

  if (!summary.originalIssuer) {
    return {
      valid: false,
      reason: 'Issuer情報が見つかりません',
    };
  }

  return { valid: true };
}
