/**
 * GET /api/v1/governance/:network
 * 仕様書 §8 ホワイトリスト管理
 *
 * ネットワーク別（devnet / mainnet）のRootLensガバナンス情報を返す。
 * 認証不要（公開情報）。アプリ起動時にフェッチしてローカルキャッシュする想定。
 *
 * extensions は3カテゴリ:
 *   core — 常に含める
 *   certificate — C2PA署名者(signer_org)から判定して選択
 *   perceptual_hash — メディア種別から判定して選択
 *
 * アプリは processor_ids = [core] + [matched cert] + [matched hash] を構築してTPに送信する。
 */

import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

interface CertExtension {
  /** Title Protocol Extension ID */
  id: string;
  /** C2PA readManifest() の signer_org にこの文字列が含まれていればマッチ */
  match_signer_org: string;
  /** UI表示名 */
  label: string;
}

interface PerceptualHashExtension {
  id: string;
  /** "image" | "video" */
  media_type: string;
}

interface TsaProvider {
  url: string;
  label: string;
}

interface IntermediateCaInfo {
  platform: "ios" | "android";
  fingerprint: string;
  status: "active" | "revoked";
}

interface GovernanceResponse {
  network: string;
  version: string;
  extensions: {
    core: string[];
    certificate: CertExtension[];
    perceptual_hash: PerceptualHashExtension[];
  };
  tsa_policy: {
    required: boolean;
    trusted_providers: TsaProvider[];
  };
  pki: {
    root_ca_fingerprint: string;
    intermediate_cas: IntermediateCaInfo[];
  };
  solana: {
    cluster: string;
    rpc_url: string;
  };
}

// ---------------------------------------------------------------------------
// Extension 定義
// ---------------------------------------------------------------------------

const CORE_EXTENSIONS = ["core-c2pa"];

const CERT_EXTENSIONS: CertExtension[] = [
  { id: "cert-rootlens", match_signer_org: "RootLens", label: "RootLens" },
  { id: "cert-google", match_signer_org: "Google", label: "Google Pixel" },
  { id: "cert-sony", match_signer_org: "Sony", label: "Sony" },
  { id: "cert-leica", match_signer_org: "Leica", label: "Leica" },
];

const PERCEPTUAL_HASH_EXTENSIONS: PerceptualHashExtension[] = [
  { id: "image-pdq", media_type: "image" },
  { id: "video-vpdq", media_type: "video" },
];

const TSA_PROVIDERS: TsaProvider[] = [
  { url: "http://timestamp.digicert.com", label: "DigiCert" },
];

// ---------------------------------------------------------------------------
// ネットワーク別設定
// ---------------------------------------------------------------------------

const NETWORK_CONFIG: Record<string, { cluster: string; rpc_url: string }> = {
  devnet: {
    cluster: "devnet",
    rpc_url: process.env.NEXT_PUBLIC_DAS_RPC_URL || "https://api.devnet.solana.com",
  },
  mainnet: {
    cluster: "mainnet-beta",
    rpc_url: process.env.MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com",
  },
};

// ---------------------------------------------------------------------------
// PKI
// ---------------------------------------------------------------------------

function getPkiInfo(): GovernanceResponse["pki"] {
  return {
    root_ca_fingerprint: process.env.ROOT_CA_FINGERPRINT || "pending",
    intermediate_cas: [
      {
        platform: "ios",
        fingerprint: process.env.IOS_INTERMEDIATE_CA_FINGERPRINT || "pending",
        status: "active",
      },
      {
        platform: "android",
        fingerprint: process.env.ANDROID_INTERMEDIATE_CA_FINGERPRINT || "pending",
        status: "active",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Route Handler
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ network: string }> },
) {
  const { network } = await params;

  if (!NETWORK_CONFIG[network]) {
    return NextResponse.json(
      { error: `Unknown network: ${network}. Use 'devnet' or 'mainnet'.` },
      { status: 400 },
    );
  }

  const response: GovernanceResponse = {
    network,
    version: "0.1.0",
    extensions: {
      core: CORE_EXTENSIONS,
      certificate: CERT_EXTENSIONS,
      perceptual_hash: PERCEPTUAL_HASH_EXTENSIONS,
    },
    tsa_policy: {
      required: true,
      trusted_providers: TSA_PROVIDERS,
    },
    pki: getPkiInfo(),
    solana: NETWORK_CONFIG[network],
  };

  return NextResponse.json(response, {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
