/**
 * デバイス証明書のDB記録・CRL管理
 * 仕様書 §4.7 鍵ライフサイクル管理
 *
 * Supabase (service_role) を使用して証明書発行ログと失効リストを永続化する。
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Supabase client（service_role — RLSバイパス）
// ---------------------------------------------------------------------------

let supabaseClient: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (supabaseClient) return supabaseClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  supabaseClient = createClient(url, key);
  return supabaseClient;
}

// ---------------------------------------------------------------------------
// 証明書発行記録
// ---------------------------------------------------------------------------

export interface CertificateRecord {
  serialNumber: string;
  deviceIdHash: string;
  platform: "android" | "ios";
  attestationLevel?: string | null;
  issuedAt: Date;
  expiresAt: Date;
}

/**
 * 発行されたDevice Certificateを記録する。
 * issueDeviceCertificate() の後に呼び出す。
 */
export async function recordCertificateIssuance(record: CertificateRecord): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("device_certificates").insert({
    serial_number: record.serialNumber,
    device_id_hash: record.deviceIdHash,
    platform: record.platform,
    attestation_level: record.attestationLevel ?? null,
    issued_at: record.issuedAt.toISOString(),
    expires_at: record.expiresAt.toISOString(),
  });
  if (error) {
    console.error("[CertStore] Failed to record certificate:", error);
    throw new Error(`Certificate record failed: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// CRL（証明書失効リスト）— Supabase永続化版
// ---------------------------------------------------------------------------

/**
 * 証明書を失効させる。
 */
export async function revokeCertificate(
  serialNumber: string,
  reason: string = "unspecified",
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("device_certificates")
    .update({
      revoked_at: new Date().toISOString(),
      revocation_reason: reason,
    })
    .eq("serial_number", serialNumber.toLowerCase())
    .is("revoked_at", null);

  if (error) {
    console.error("[CertStore] Failed to revoke certificate:", error);
    throw new Error(`Certificate revocation failed: ${error.message}`);
  }
}

/**
 * 証明書が失効されているか確認する。
 */
export async function isRevoked(serialNumber: string): Promise<boolean> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("device_certificates")
    .select("revoked_at")
    .eq("serial_number", serialNumber.toLowerCase())
    .single();

  if (error || !data) return false;
  return data.revoked_at !== null;
}

/**
 * 全失効シリアル番号を取得する（CRLエンドポイント用）。
 */
export async function getRevokedSerials(): Promise<string[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("device_certificates")
    .select("serial_number")
    .not("revoked_at", "is", null);

  if (error || !data) return [];
  return data.map((row) => row.serial_number);
}

/**
 * デバイスIDで発行済み証明書を検索する（renew時の鍵一致検証用）。
 */
export async function findActiveByDeviceId(
  deviceIdHash: string,
): Promise<{ serialNumber: string; expiresAt: string } | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("device_certificates")
    .select("serial_number, expires_at")
    .eq("device_id_hash", deviceIdHash)
    .is("revoked_at", null)
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return { serialNumber: data.serial_number, expiresAt: data.expires_at };
}
