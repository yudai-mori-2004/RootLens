// Title Protocol への submission (= @title-protocol/sdk 直叩き)。
//
// SPECS_JA §3 / §6.2 ステップ 5。 サーバが R2 から ぼかし済 MP4 を取り出し、
// TitleClient.register に渡して Root NFT を発行する。
//
// 重要 (= WDK bundler 制約):
//   この module は Workflow DevKit の bundler で 「workflow worker context」 に
//   取り込まれる。 そこは ESM only sandbox で、 AWS SDK の dist-es に隠れている
//   `require("node:stream")` が解決できず ReferenceError になる。
//   そのため:
//     - top-level で S3Client / @title-protocol/sdk を import しない
//     - submitToTp の中で dynamic import + lazy 初期化
//     - R2 ダウンロードは fetch + 自前 SigV4 ではなく presigned URL 経由
//       (= URL 発行も dynamic import で隔離)

export interface TpSubmitRequest {
  /// ぼかし済 MP4 の R2 オブジェクトキー (= R2_BUCKET_BLURRED にある)
  blurredR2Key: string;
  blurredContentHash: string;
  ownerWalletPubkey: string;
  rootlensLicenseInput: {
    tosVersion: string;
    tosHash: string;
  };
  idempotencyKey: string;
}

export interface TpSubmitResult {
  rootAssetId: string;
  signedJsonUri: string;
  alreadyIssued: boolean;
}

// ─── GlobalConfig + TitleClient のキャッシュ ────────────────────────

let cachedClient: any = null;

async function getClient(): Promise<any> {
  if (cachedClient) return cachedClient;
  const { fetchGlobalConfig, TitleClient } = await import("@title-protocol/sdk");
  const network = (process.env.TP_NETWORK ?? "devnet") as "devnet" | "mainnet";
  const config = await fetchGlobalConfig(network);
  cachedClient = new TitleClient(config);
  return cachedClient;
}

// R2 からのダウンロードは presigned GET URL + fetch で実施 (= AWS SDK を
// workflow worker bundle に取り込まないため)。 presigner も dynamic import 隔離。
async function downloadFromR2(key: string): Promise<Uint8Array> {
  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");

  const r2 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  const bucket = process.env.R2_BUCKET_BLURRED ?? "rootlens-mcap-blurred";
  const url = await getSignedUrl(r2, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: 600,
  });
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`R2 download failed: ${res.status} ${res.statusText}`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

// ─── 公開 API ─────────────────────────────────────────────────────────

export async function submitToTp(req: TpSubmitRequest): Promise<TpSubmitResult> {
  const client = await getClient();
  const content = await downloadFromR2(req.blurredR2Key);

  // gatewayEndpoint は指定しない: SDK 設計どおり健全 TEE ノードを random 選択させる。
  const result = await client.register({
    content,
    ownerWallet: req.ownerWalletPubkey,
    processorIds: ["core-c2pa"],
    delegateMint: true,
    extensionInputs: {
      "rootlens-license-v1": {
        tos_version: req.rootlensLicenseInput.tosVersion,
        tos_hash: req.rootlensLicenseInput.tosHash,
      },
    },
  });

  // SDK の register 結果 schema は version で揺れるので、 候補 field 名から最初に見つかったものを採用
  const first = result?.contents?.[0];
  if (!first) throw new Error("TP register returned no contents");

  const rootAssetId =
    (first as any).rootAssetId ??
    (first as any).cnftAssetId ??
    (first as any).signedJson?.payload?.cnft_asset_id ??
    (first as any).signedJson?.payload?.content_hash ??
    "";
  const signedJsonUri =
    (first as any).storageUri ??
    (first as any).signedJsonUri ??
    "";

  return {
    rootAssetId,
    signedJsonUri,
    alreadyIssued: false,
  };
}
