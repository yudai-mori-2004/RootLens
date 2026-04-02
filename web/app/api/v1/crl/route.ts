/**
 * GET /api/v1/crl
 * CRL（証明書失効リスト）エンドポイント
 * 仕様書 §4.7 鍵ライフサイクル管理
 *
 * 失効したDevice CertificateのシリアルナンバーリストをJSON形式で返却。
 * 公開ページの検証時にフェッチされる。
 *
 * データソース: Supabase (device_certificates テーブル)
 * フォールバック: インメモリCRL (Supabase未接続時)
 */

import { NextResponse } from "next/server";
import { getRevokedSerials as getDbRevokedSerials } from "@/lib/server/cert-store";
import { getRevokedSerials as getMemoryRevokedSerials } from "@/lib/server/crl";

export async function GET() {
  let revoked: string[];

  try {
    // Supabase から取得（本番用）
    revoked = await getDbRevokedSerials();
  } catch {
    // フォールバック: インメモリCRL（dev / Supabase未接続時）
    revoked = getMemoryRevokedSerials();
  }

  return NextResponse.json({
    revoked_serials: revoked,
    updated_at: new Date().toISOString(),
  }, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300", // 5分キャッシュ
    },
  });
}
