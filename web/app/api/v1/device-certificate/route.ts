/**
 * POST /api/v1/device-certificate
 * 仕様書 §4.4.2 証明書発行API
 *
 * CSR + Platform Attestation を受け取り、Device Certificate を発行する。
 * Dev Mode: Attestation検証をスキップ（DEV_MODE=true）
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { verifyCSR, issueDeviceCertificate, DEVICE_CERT_VALIDITY_DAYS } from "@/lib/server/ca";
import { recordCertificateIssuance } from "@/lib/server/cert-store";
import { verifyAndroidAttestation } from "@/lib/server/attestation-android";
import { verifyIOSAttestation as verifyIOSAppAttest } from "@/lib/server/attestation-ios";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/server/rate-limit";

// 安全なデフォルト: 明示的に DEV_MODE=true を設定しない限りAttestation必須
const DEV_MODE = process.env.DEV_MODE === "true";

interface DeviceCertRequest {
  platform: "android" | "ios";
  csr: string; // Base64 DER
  attestation?: {
    // Android
    key_attestation_chain?: string[];
    play_integrity_token?: string;
    // iOS
    app_attest_object?: string;
    app_attest_key_id?: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    // §4.4.3: IPベースのレート制限
    const ip = getClientIp(request);
    const rl = checkRateLimit(`cert-issue:${ip}`, RATE_LIMITS.certIssue);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }

    const body: DeviceCertRequest = await request.json();

    // 必須フィールド検証
    if (!body.platform || !body.csr) {
      return NextResponse.json(
        { error: "Missing required fields: platform, csr" },
        { status: 400 }
      );
    }

    if (body.platform !== "android" && body.platform !== "ios") {
      return NextResponse.json(
        { error: "Invalid platform. Must be 'android' or 'ios'" },
        { status: 400 }
      );
    }

    // CSR検証（Proof of Possession）
    const csrResult = await verifyCSR(body.csr);
    if (!csrResult.valid || !csrResult.publicKey) {
      return NextResponse.json(
        { error: csrResult.error || "CSR verification failed" },
        { status: 400 }
      );
    }

    // Platform Attestation 検証
    let attestationLevel: string | null = null;
    if (!DEV_MODE) {
      if (!body.attestation) {
        return NextResponse.json(
          { error: "Attestation required in production mode" },
          { status: 400 }
        );
      }

      // CSR公開鍵のSPKI DERを取得（attestation certとの紐づけ検証用）
      const csrPubKeySpki = new Uint8Array(
        await crypto.webcrypto.subtle.exportKey("spki", csrResult.publicKey!),
      );

      const attestationResult = await verifyAttestation(
        body.platform,
        body.csr,
        body.attestation,
        csrPubKeySpki,
      );
      if (!attestationResult.valid) {
        return NextResponse.json(
          { error: attestationResult.error || "Attestation verification failed" },
          { status: 403 }
        );
      }
      attestationLevel = attestationResult.securityLevel ?? null;
    }

    // Device Certificate 発行（プラットフォーム別 Intermediate CA で署名）
    const result = await issueDeviceCertificate(
      csrResult.publicKey,
      csrResult.deviceIdHash,
      body.platform,
    );

    // 発行記録をDBに保存（CRL・監査用）
    const now = new Date();
    try {
      await recordCertificateIssuance({
        serialNumber: result.serialNumber,
        deviceIdHash: result.deviceId,
        platform: body.platform,
        attestationLevel,
        issuedAt: now,
        expiresAt: new Date(now.getTime() + DEVICE_CERT_VALIDITY_DAYS * 24 * 60 * 60 * 1000),
      });
    } catch (dbError) {
      // DB記録失敗は証明書発行自体を失敗させない（証明書は既に生成済み）
      console.error("[CA] Failed to record certificate issuance:", dbError);
    }

    return NextResponse.json({
      device_certificate: result.deviceCertDer,
      intermediate_ca_certificate: result.intermediateCaCertDer,
      root_ca_certificate: result.rootCaCertDer,
      device_id: result.deviceId,
    });
  } catch (e) {
    console.error("Certificate issuance error:", e);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// --- Platform Attestation 検証 ---

async function verifyAttestation(
  platform: "android" | "ios",
  csrBase64: string,
  attestation: NonNullable<DeviceCertRequest["attestation"]>,
  csrPublicKeySpki: Uint8Array,
): Promise<{ valid: boolean; securityLevel?: string; error?: string }> {
  if (platform === "android") {
    return verifyAndroidAttestation(
      csrBase64,
      {
        key_attestation_chain: attestation.key_attestation_chain ?? [],
        play_integrity_token: attestation.play_integrity_token,
      },
      csrPublicKeySpki,
    );
  } else {
    return verifyIOSAttestation(csrBase64, attestation);
  }
}

async function verifyIOSAttestation(
  csrBase64: string,
  attestation: NonNullable<DeviceCertRequest["attestation"]>,
): Promise<{ valid: boolean; error?: string }> {
  if (!attestation.app_attest_object || !attestation.app_attest_key_id) {
    return { valid: false, error: "app_attest_object and app_attest_key_id are required for iOS" };
  }
  return verifyIOSAppAttest(csrBase64, {
    app_attest_object: attestation.app_attest_object,
    app_attest_key_id: attestation.app_attest_key_id,
  });
}
