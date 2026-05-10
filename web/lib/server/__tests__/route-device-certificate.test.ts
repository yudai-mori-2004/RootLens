/**
 * POST /api/v1/device-certificate (および /renew) の route 層テスト。
 *
 * 既存 ca.test.ts は `verifyCSR` / `issueDeviceCertificate` の関数単位の検証に留まる。
 * 本テストは route handler 全体 (request validation → attestation 検証 → 発行 →
 * DB 記録) を end-to-end で叩いて API 契約を audit-grade で固める。
 *
 * Mock 対象:
 *   - attestation-ios / attestation-android (実 App Attest / Key Attestation を test で再現不可)
 *   - cert-store (Supabase 接続を avoid)
 *
 * 実コード:
 *   - verifyCSR (CSR PoP + EC P-256 強制) はそのまま動かす
 *   - issueDeviceCertificate (PKI 階層 + x509 extension) もそのまま動かす
 *   - rate-limit もそのまま動かす (test 間で _resetStore で reset)
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import * as x509 from "@peculiar/x509";
import crypto from "crypto";
import { NextRequest } from "next/server";

import { _resetCache } from "../ca";
import { _resetStore as _resetRateLimit } from "../rate-limit";

// ---------------------------------------------------------------------------
// テスト用 PKI (ca.test.ts と同じパターン)
// ---------------------------------------------------------------------------

x509.cryptoProvider.set(crypto.webcrypto as Crypto);

let rootCaKeyPair: CryptoKeyPair;
let rootCaCert: x509.X509Certificate;
let icaKeyPair: CryptoKeyPair;
let icaCert: x509.X509Certificate;

beforeAll(async () => {
  rootCaKeyPair = await crypto.webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  rootCaCert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: "01",
    name: "CN=Test Root CA, O=Test, C=JP",
    notBefore: new Date(),
    notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    keys: rootCaKeyPair,
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    extensions: [
      new x509.BasicConstraintsExtension(true, 1, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
        true,
      ),
    ],
  });

  icaKeyPair = await crypto.webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  icaCert = await x509.X509CertificateGenerator.create({
    serialNumber: "02",
    subject: "CN=Test ICA, O=Test, C=JP",
    issuer: rootCaCert.subject,
    notBefore: new Date(),
    notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    publicKey: icaKeyPair.publicKey,
    signingKey: rootCaKeyPair.privateKey,
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
        true,
      ),
    ],
  });

  const icaKeyPkcs8 = await crypto.webcrypto.subtle.exportKey("pkcs8", icaKeyPair.privateKey);
  const icaKeyPem =
    `-----BEGIN PRIVATE KEY-----\n${Buffer.from(icaKeyPkcs8).toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----`;

  process.env.ROOT_CA_CERT_PEM = rootCaCert.toString("pem");
  process.env.IOS_INTERMEDIATE_CA_CERT_PEM = icaCert.toString("pem");
  process.env.IOS_INTERMEDIATE_CA_KEY_PEM = icaKeyPem;
  process.env.ANDROID_INTERMEDIATE_CA_CERT_PEM = icaCert.toString("pem");
  process.env.ANDROID_INTERMEDIATE_CA_KEY_PEM = icaKeyPem;
});

beforeEach(() => {
  vi.resetModules();
  _resetCache();
  _resetRateLimit();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function generateCsr(curve: "P-256" | "P-384" = "P-256"): Promise<string> {
  const keyPair = await crypto.webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: curve },
    true,
    ["sign", "verify"],
  );
  const csr = await x509.Pkcs10CertificateRequestGenerator.create({
    name: "CN=RootLens Device, O=RootLens",
    keys: keyPair,
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
  });
  return Buffer.from(csr.rawData).toString("base64");
}

interface LoadRouteOpts {
  devMode?: boolean;
  iosAttestResult?: { valid: true } | { valid: false; error?: string };
  androidAttestResult?: { valid: true; securityLevel?: string } | { valid: false; error?: string };
  recordIssuanceImpl?: () => Promise<void>;
}

/**
 * mock を仕込んで route handler を動的に import。
 * DEV_MODE は module top-level で読まれるので、動的 import 前に env を設定する必要がある。
 */
async function loadDeviceCertRoute(opts: LoadRouteOpts = {}) {
  process.env.DEV_MODE = opts.devMode ? "true" : "false";

  vi.doMock("../attestation-ios", () => ({
    verifyIOSAttestation: vi.fn().mockResolvedValue(opts.iosAttestResult ?? { valid: true }),
  }));
  vi.doMock("../attestation-android", () => ({
    verifyAndroidAttestation: vi.fn().mockResolvedValue(opts.androidAttestResult ?? { valid: true, securityLevel: "STRONG_BOX" }),
  }));
  vi.doMock("../cert-store", () => ({
    recordCertificateIssuance: vi.fn().mockImplementation(opts.recordIssuanceImpl ?? (async () => undefined)),
    findActiveByDeviceId: vi.fn().mockResolvedValue(null),
  }));

  const mod = await import("../../../app/api/v1/device-certificate/route");
  return mod.POST;
}

interface RequestBody {
  platform?: "ios" | "android" | string;
  csr?: string;
  attestation?: Record<string, unknown>;
}

function buildRequest(body: RequestBody | string, ip = `10.0.0.${Math.floor(Math.random() * 254) + 1}`): NextRequest {
  return new NextRequest("http://localhost/api/v1/device-certificate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const validIosAttestation = {
  app_attest_object: "MOCK_OBJ",
  app_attest_key_id: "MOCK_KEY_ID",
};

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("POST /api/v1/device-certificate (happy)", () => {
  it("H1: 正規 iOS リクエスト → 200 + 3 段 cert chain を返す", async () => {
    const POST = await loadDeviceCertRoute();
    const csr = await generateCsr();

    const res = await POST(buildRequest({ platform: "ios", csr, attestation: validIosAttestation }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.device_certificate).toBeTruthy();
    expect(json.intermediate_ca_certificate).toBeTruthy();
    expect(json.root_ca_certificate).toBeTruthy();
    expect(json.device_id).toHaveLength(16);

    // 返ってきた cert は ICA で署名されている
    const deviceCert = new x509.X509Certificate(Buffer.from(json.device_certificate, "base64"));
    expect(await deviceCert.verify({ publicKey: await icaCert.publicKey.export() })).toBe(true);
    // subject に device_id_hash が入っている
    expect(deviceCert.subject).toContain(json.device_id);
  });

  it("DB 記録失敗は cert 発行を失敗させない (non-fatal)", async () => {
    const POST = await loadDeviceCertRoute({
      recordIssuanceImpl: async () => {
        throw new Error("simulated DB failure");
      },
    });
    const csr = await generateCsr();

    const res = await POST(buildRequest({ platform: "ios", csr, attestation: validIosAttestation }));
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Adversarial — must reject (mirroring D's audit-grade structure)
// ---------------------------------------------------------------------------

describe("POST /api/v1/device-certificate (adversarial)", () => {
  it("A1: platform 欠落 → 400", async () => {
    const POST = await loadDeviceCertRoute();
    const csr = await generateCsr();
    const res = await POST(buildRequest({ csr, attestation: validIosAttestation }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/platform/);
  });

  it("A2: invalid platform → 400", async () => {
    const POST = await loadDeviceCertRoute();
    const csr = await generateCsr();
    const res = await POST(buildRequest({ platform: "windows", csr, attestation: validIosAttestation }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/platform/);
  });

  it("A3: csr 欠落 → 400", async () => {
    const POST = await loadDeviceCertRoute();
    const res = await POST(buildRequest({ platform: "ios", attestation: validIosAttestation }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/csr/);
  });

  it("A4: 不正な base64 CSR → 400", async () => {
    const POST = await loadDeviceCertRoute();
    const res = await POST(buildRequest({ platform: "ios", csr: "!!!not-base64!!!", attestation: validIosAttestation }));
    expect(res.status).toBe(400);
  });

  it("A5: EC P-384 CSR → 400 (P-256 強制)", async () => {
    const POST = await loadDeviceCertRoute();
    const csr = await generateCsr("P-384");
    const res = await POST(buildRequest({ platform: "ios", csr, attestation: validIosAttestation }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/P-256/);
  });

  it("A6: production mode で attestation 欠落 → 400", async () => {
    const POST = await loadDeviceCertRoute({ devMode: false });
    const csr = await generateCsr();
    const res = await POST(buildRequest({ platform: "ios", csr }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/attestation/i);
  });

  it("A7: attestation 検証失敗 → 403", async () => {
    const POST = await loadDeviceCertRoute({
      iosAttestResult: { valid: false, error: "fake attest fail" },
    });
    const csr = await generateCsr();
    const res = await POST(buildRequest({ platform: "ios", csr, attestation: validIosAttestation }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/attest/i);
  });

  it("A8: malformed JSON body → 500 (or 400)", async () => {
    const POST = await loadDeviceCertRoute();
    const res = await POST(buildRequest("{not json"));
    expect([400, 500]).toContain(res.status);
  });

  it("A9: rate limit exceeded → 429 with Retry-After", async () => {
    const POST = await loadDeviceCertRoute();
    const csr = await generateCsr();
    const sameIp = "10.99.99.99";

    // RATE_LIMITS.certIssue の上限まで連続 fire (rate-limit.ts の RATE_LIMITS を尊重)
    let last;
    for (let i = 0; i < 12; i++) {
      last = await POST(buildRequest({ platform: "ios", csr, attestation: validIosAttestation }, sameIp));
      if (last.status === 429) break;
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get("Retry-After")).toBeTruthy();
    const json = await last!.json();
    expect(json.error).toMatch(/Rate limit/i);
  });

  it("A10: DEV_MODE=true なら attestation なしでも 200", async () => {
    const POST = await loadDeviceCertRoute({ devMode: true });
    const csr = await generateCsr();
    const res = await POST(buildRequest({ platform: "ios", csr }));
    expect(res.status).toBe(200);
  });

  it("A11: Android 経路でも同等に検証する (smoke check)", async () => {
    const POST = await loadDeviceCertRoute({
      androidAttestResult: { valid: true, securityLevel: "STRONG_BOX" },
    });
    const csr = await generateCsr();
    const res = await POST(buildRequest({ platform: "android", csr, attestation: { key_attestation_chain: ["mock"], play_integrity_token: "mock" } }));
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Issued cert quality (audit grade — extension layout を route 経由で全数検査)
// ---------------------------------------------------------------------------

describe("issued certificate (via route)", () => {
  it("90 日有効 / KeyUsage digitalSignature / EKU documentSigning / CA:false", async () => {
    const POST = await loadDeviceCertRoute();
    const csr = await generateCsr();
    const res = await POST(buildRequest({ platform: "ios", csr, attestation: validIosAttestation }));
    const json = await res.json();
    const cert = new x509.X509Certificate(Buffer.from(json.device_certificate, "base64"));

    // 有効期間 ~= 90 日
    const days = (cert.notAfter.getTime() - cert.notBefore.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThanOrEqual(89.9);
    expect(days).toBeLessThanOrEqual(90.1);

    // BasicConstraints CA:false (critical)
    const bc = cert.getExtension(x509.BasicConstraintsExtension);
    expect(bc).toBeTruthy();
    expect(bc!.ca).toBe(false);
    expect(bc!.critical).toBe(true);

    // KeyUsage = digitalSignature only
    const ku = cert.getExtension(x509.KeyUsagesExtension);
    expect(ku).toBeTruthy();
    expect(ku!.usages & x509.KeyUsageFlags.digitalSignature).toBeTruthy();
    expect(ku!.critical).toBe(true);

    // EKU = id-kp-documentSigning (1.3.6.1.5.5.7.3.36, RFC 9336)
    const eku = cert.getExtension(x509.ExtendedKeyUsageExtension);
    expect(eku).toBeTruthy();
    expect(eku!.usages).toContain("1.3.6.1.5.5.7.3.36");

    // SKI / AKI 両方ある (chain validation 用)
    expect(cert.getExtension(x509.SubjectKeyIdentifierExtension)).toBeTruthy();
    expect(cert.getExtension(x509.AuthorityKeyIdentifierExtension)).toBeTruthy();
  });

  it("毎発行で異なるシリアル (リプレイ耐性)", async () => {
    const POST = await loadDeviceCertRoute();
    const csr = await generateCsr();
    const res1 = await POST(buildRequest({ platform: "ios", csr, attestation: validIosAttestation }));
    const res2 = await POST(buildRequest({ platform: "ios", csr, attestation: validIosAttestation }));
    const c1 = new x509.X509Certificate(Buffer.from((await res1.json()).device_certificate, "base64"));
    const c2 = new x509.X509Certificate(Buffer.from((await res2.json()).device_certificate, "base64"));
    expect(c1.serialNumber).not.toBe(c2.serialNumber);
  });

  it("3 段 chain (Device → ICA → Root) すべて返却され検証可能", async () => {
    const POST = await loadDeviceCertRoute();
    const csr = await generateCsr();
    const res = await POST(buildRequest({ platform: "ios", csr, attestation: validIosAttestation }));
    const json = await res.json();

    const device = new x509.X509Certificate(Buffer.from(json.device_certificate, "base64"));
    const ica = new x509.X509Certificate(Buffer.from(json.intermediate_ca_certificate, "base64"));
    const root = new x509.X509Certificate(Buffer.from(json.root_ca_certificate, "base64"));

    expect(await device.verify({ publicKey: await ica.publicKey.export() })).toBe(true);
    expect(await ica.verify({ publicKey: await root.publicKey.export() })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/device-certificate/renew
// ---------------------------------------------------------------------------
// 初回発行と共通の検証 (CSR PoP / EC P-256 / attestation 必須) は
// route-device-certificate (上の describe) 側で網羅済。ここでは renew 固有の
// 動作のみテストする:
//   - 既存 cert (findActiveByDeviceId) が無いと拒否される
//   - DB エラー時は dev 環境想定でスキップされる
//   - rate-limit が初回発行と独立 (上限 5 / hour、prefix `cert-renew:`)
//   - エラーメッセージが renew 用文言になっている

interface LoadRenewOpts {
  devMode?: boolean;
  iosAttestResult?: { valid: true } | { valid: false; error?: string };
  /** findActiveByDeviceId の戻り値: existing record / null / throw */
  existing?: { found: true } | { found: false } | { throw: true };
}

async function loadRenewRoute(opts: LoadRenewOpts = {}) {
  process.env.DEV_MODE = opts.devMode ? "true" : "false";

  vi.doMock("../attestation-ios", () => ({
    verifyIOSAttestation: vi.fn().mockResolvedValue(opts.iosAttestResult ?? { valid: true }),
  }));
  vi.doMock("../attestation-android", () => ({
    verifyAndroidAttestation: vi.fn().mockResolvedValue({ valid: true, securityLevel: "STRONG_BOX" }),
  }));

  // findActiveByDeviceId の挙動を opts で切替
  let findActiveImpl: () => Promise<unknown>;
  const e = opts.existing ?? { found: true };
  if ("throw" in e) {
    findActiveImpl = async () => { throw new Error("simulated DB error"); };
  } else if (e.found) {
    findActiveImpl = async () => ({ serial_number: "old-serial", device_id_hash: "anyhash", platform: "ios", issued_at: new Date(), expires_at: new Date(Date.now() + 1000 * 86400) });
  } else {
    findActiveImpl = async () => null;
  }

  vi.doMock("../cert-store", () => ({
    recordCertificateIssuance: vi.fn().mockResolvedValue(undefined),
    findActiveByDeviceId: vi.fn().mockImplementation(findActiveImpl),
  }));

  const mod = await import("../../../app/api/v1/device-certificate/renew/route");
  return mod.POST;
}

function buildRenewRequest(body: RequestBody | string, ip = `10.1.0.${Math.floor(Math.random() * 254) + 1}`): NextRequest {
  return new NextRequest("http://localhost/api/v1/device-certificate/renew", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/v1/device-certificate/renew (happy)", () => {
  it("R1: 同じ端末鍵で既存 cert があるとき → 200 + 新しい cert chain", async () => {
    const POST = await loadRenewRoute({ existing: { found: true } });
    const csr = await generateCsr();
    const res = await POST(buildRenewRequest({ platform: "ios", csr, attestation: validIosAttestation }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.device_certificate).toBeTruthy();
    expect(json.intermediate_ca_certificate).toBeTruthy();
    expect(json.root_ca_certificate).toBeTruthy();
    // device_id は同じ key 由来なので 16 文字 hex
    expect(json.device_id).toHaveLength(16);
  });

  it("R2: 同じ端末鍵で 2 回連続更新すると毎回別シリアル (旧 cert 失効しない設計の前提)", async () => {
    const POST = await loadRenewRoute({ existing: { found: true } });
    const csr = await generateCsr();
    const res1 = await POST(buildRenewRequest({ platform: "ios", csr, attestation: validIosAttestation }));
    const res2 = await POST(buildRenewRequest({ platform: "ios", csr, attestation: validIosAttestation }));
    const c1 = new x509.X509Certificate(Buffer.from((await res1.json()).device_certificate, "base64"));
    const c2 = new x509.X509Certificate(Buffer.from((await res2.json()).device_certificate, "base64"));
    // route 自体は失効処理を持たない (旧 cert を消すコードがない) → 別シリアルで両立
    expect(c1.serialNumber).not.toBe(c2.serialNumber);
  });
});

describe("POST /api/v1/device-certificate/renew (renew-specific guards)", () => {
  it("R3: 既存 cert が DB に無い (初回扱い) → 400 で初回発行への誘導メッセージ", async () => {
    const POST = await loadRenewRoute({ existing: { found: false } });
    const csr = await generateCsr();
    const res = await POST(buildRenewRequest({ platform: "ios", csr, attestation: validIosAttestation }));

    expect(res.status).toBe(400);
    const json = await res.json();
    // メッセージは "No existing certificate found ... Use /device-certificate for initial provisioning."
    expect(json.error).toMatch(/No existing certificate/i);
    expect(json.error).toMatch(/initial/i);
  });

  it("R4: DB エラーは dev 環境前提でスキップされ、更新自体は成功する", async () => {
    const POST = await loadRenewRoute({ existing: { throw: true } });
    const csr = await generateCsr();
    const res = await POST(buildRenewRequest({ platform: "ios", csr, attestation: validIosAttestation }));

    expect(res.status).toBe(200);
  });

  it("R5: production mode で attestation 欠落 → 400 で renew 用文言", async () => {
    const POST = await loadRenewRoute({ devMode: false, existing: { found: true } });
    const csr = await generateCsr();
    const res = await POST(buildRenewRequest({ platform: "ios", csr }));

    expect(res.status).toBe(400);
    const json = await res.json();
    // 初回 ("Attestation required in production mode") と区別される renew 用文言
    expect(json.error).toMatch(/renewal/i);
  });

  it("R6: DEV_MODE=true なら attestation なしでも 200 (初回と同様)", async () => {
    const POST = await loadRenewRoute({ devMode: true, existing: { found: true } });
    const csr = await generateCsr();
    const res = await POST(buildRenewRequest({ platform: "ios", csr }));

    expect(res.status).toBe(200);
  });

  it("R7: rate-limit は 5 req/hour (初回 10 req/hour と別)", async () => {
    const POST = await loadRenewRoute({ existing: { found: true } });
    const csr = await generateCsr();
    const sameIp = "10.50.50.50";

    // 5 通過 → 6 回目で 429 を期待
    let last;
    for (let i = 0; i < 7; i++) {
      last = await POST(buildRenewRequest({ platform: "ios", csr, attestation: validIosAttestation }, sameIp));
      if (last.status === 429) break;
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get("Retry-After")).toBeTruthy();
  });

  it("R8: renew の rate-limit カウンタは初回発行と独立 (key prefix が違う)", async () => {
    // 初回発行を 10 回叩いて使い切ってから、renew が 200 で通るか
    const initialPOST = await loadDeviceCertRoute();
    const sameIp = "10.60.60.60";
    const csr = await generateCsr();

    // 初回発行 rate-limit を使い切る
    for (let i = 0; i < 11; i++) {
      await initialPOST(buildRequest({ platform: "ios", csr, attestation: validIosAttestation }, sameIp));
    }

    // module 切替: renew route を別途 load
    vi.resetModules();
    _resetCache();
    // 注: rate-limit ストアは別 import が同インスタンスを共有するため reset しない
    const renewPOST = await loadRenewRoute({ existing: { found: true } });
    const res = await renewPOST(buildRenewRequest({ platform: "ios", csr, attestation: validIosAttestation }, sameIp));

    // renew カウンタは別なので 200 通る
    expect(res.status).toBe(200);
  });
});
