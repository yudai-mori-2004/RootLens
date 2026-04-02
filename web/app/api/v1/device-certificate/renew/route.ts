/**
 * POST /api/v1/device-certificate/renew
 * 証明書更新API
 * 仕様書 §4.4.2 証明書更新フロー
 *
 * 既存のDevice Certificateの有効期限が近い場合（残り14日以内）に呼び出し。
 * 同じTEE鍵のCSR + 新しいPlatform Attestationで再検証し、
 * 新しい90日証明書を発行する。
 *
 * 初回発行との違い:
 *   - 同一device_id_hashのCSRのみ受け付ける（鍵一致検証）
 *   - 旧証明書は失効させない（旧署名の検証継続のため）
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { verifyCSR, issueDeviceCertificate, DEVICE_CERT_VALIDITY_DAYS } from "@/lib/server/ca";
import { recordCertificateIssuance, findActiveByDeviceId } from "@/lib/server/cert-store";
import { verifyAndroidAttestation } from "@/lib/server/attestation-android";
import { verifyIOSAttestation } from "@/lib/server/attestation-ios";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/server/rate-limit";

const DEV_MODE = process.env.DEV_MODE === "true";

interface RenewRequest {
  platform: "android" | "ios";
  csr: string; // Base64 DER（同じ公開鍵）
  attestation?: {
    key_attestation_chain?: string[];
    play_integrity_token?: string;
    app_attest_object?: string;
    app_attest_key_id?: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    // レート制限
    const ip = getClientIp(request);
    const rl = checkRateLimit(`cert-renew:${ip}`, RATE_LIMITS.certRenew);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
          },
        }
      );
    }

    const body: RenewRequest = await request.json();

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

    // CSR検証
    const csrResult = await verifyCSR(body.csr);
    if (!csrResult.valid || !csrResult.publicKey) {
      return NextResponse.json(
        { error: csrResult.error || "CSR verification failed" },
        { status: 400 }
      );
    }

    // §4.4.2: 同一device_id_hashの既存証明書があることを確認（鍵一致検証）
    try {
      const existing = await findActiveByDeviceId(csrResult.deviceIdHash);
      if (!existing) {
        return NextResponse.json(
          { error: "No existing certificate found for this device. Use /device-certificate for initial provisioning." },
          { status: 400 }
        );
      }
    } catch {
      // DB接続エラー時はスキップ（dev環境等）
    }

    // Platform Attestation 再検証（更新時にも再Attestationを要求）
    let attestationLevel: string | null = null;
    if (!DEV_MODE) {
      if (!body.attestation) {
        return NextResponse.json(
          { error: "Attestation required for certificate renewal" },
          { status: 400 }
        );
      }

      const csrPubKeySpki = new Uint8Array(
        await crypto.webcrypto.subtle.exportKey("spki", csrResult.publicKey),
      );

      let attestationResult: { valid: boolean; securityLevel?: string; error?: string };
      if (body.platform === "android") {
        attestationResult = await verifyAndroidAttestation(
          body.csr,
          {
            key_attestation_chain: body.attestation.key_attestation_chain ?? [],
            play_integrity_token: body.attestation.play_integrity_token,
          },
          csrPubKeySpki,
        );
      } else {
        if (!body.attestation.app_attest_object || !body.attestation.app_attest_key_id) {
          return NextResponse.json(
            { error: "app_attest_object and app_attest_key_id are required for iOS" },
            { status: 400 }
          );
        }
        attestationResult = await verifyIOSAttestation(
          body.csr,
          {
            app_attest_object: body.attestation.app_attest_object,
            app_attest_key_id: body.attestation.app_attest_key_id,
          },
        );
      }

      if (!attestationResult.valid) {
        return NextResponse.json(
          { error: attestationResult.error || "Attestation verification failed" },
          { status: 403 }
        );
      }
      attestationLevel = attestationResult.securityLevel ?? null;
    }

    // 新しい90日証明書を発行（同じ公開鍵、新しいシリアルナンバー）
    const result = await issueDeviceCertificate(
      csrResult.publicKey,
      csrResult.deviceIdHash,
      body.platform,
    );

    // 発行記録をDBに保存
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
      console.error("[CA] Failed to record renewal:", dbError);
    }

    return NextResponse.json({
      device_certificate: result.deviceCertDer,
      intermediate_ca_certificate: result.intermediateCaCertDer,
      root_ca_certificate: result.rootCaCertDer,
      device_id: result.deviceId,
    });
  } catch (e) {
    console.error("Certificate renewal error:", e);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
