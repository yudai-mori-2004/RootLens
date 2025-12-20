// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// C2PA Manifest Parser (Inspired by verify-site)
// ManifestStoreから表示用サマリーデータを抽出するユーティリティ
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import {
  selectGenerativeInfo,
  selectProducer,
  type Manifest,
  type ManifestStore,
  type Assertion,
} from 'c2pa';
import { DEVICE_HASH_SPECS, DeviceHashSpec, getTrustedIssuerNames } from './hash-specs';

export interface C2PASummaryData {
  activeManifest: ManifestSummary | null;
  validationStatus: ValidationSummary;
  thumbnailUrl: string | null;

  // 統合: Arweaveに送信するデータ
  sourceType: string | null;        // "digitalCapture" | "trainedAlgorithmicMedia" | null
  claimGenerator: string | null;    // e.g., "Google Pixel 7 1.0" (最新)

  // ★追加: Root（最古）マニフェストの情報
  originalClaimGenerator: string | null; // e.g., "Sony ILCE-7M4" (最古)
  originalIssuer: string | null;         // e.g., "C2PA Test Signing Cert" (最古)
  isTrustedRootIssuer: boolean;          // Root Issuerが信頼できるか
}

export interface ManifestSummary {
  label: string | null;
  title: string | null;
  format: string;
  vendor: string | null;
  claimGenerator: string | null; // User Agent string
  claimGeneratorInfo: {
    name: string;
    version: string | null;
    icon: string | null;
  };
  claimGeneratorHints: Record<string, unknown> | null;
  instanceId: string | null;
  signatureInfo: {
    issuer: string | null;
    time: string | null;
  };
  credentials: CredentialSummary[];
  producer: {
    name: string | null;
  } | null;
  ingredients: IngredientSummary[];
  redactions: string[];
  assertions: {
    generativeInfo: unknown | null;
    exif: unknown | null;
    actions: ActionSummary[];
    allAssertions: Record<string, unknown>; // 全てのassertion（生データ）
  };
  isAIGenerated: boolean;
  dataHash: string | null; // 追加: C2PA Data Hash (Hard Binding)
  rootThumbnailUrl: string | null; // 追加: Root（始祖）のサムネイル
  verifiedIdentities: VerifiedIdentitySummary[];
  cawgIssuers: string[];
  isTrustedIssuer: boolean; // 追加: このIssuerがRootLensで信頼されているか
}

export interface IngredientSummary {
  title: string;
  format: string;
  thumbnailUrl: string | null;
}

export interface ActionSummary {
  action: string;
  description: string | null;
  digitalSourceType: string | null;
  when: string | null;
}

export interface ValidationSummary {
  isValid: boolean;
  errors: string[];
}

export interface CredentialSummary {
  url: string | null;
  issuer: string | null;
  type: string | null;
}

export interface VerifiedIdentitySummary {
  name: string | null;
  identifier: string | null;
  issuer: string | null;
}

// Helper: Convert byte array to hex string
function bytesToHex(bytes: number[] | Uint8Array): string {
  if (bytes instanceof Uint8Array) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

// C2PAで定義されている定数（ハードウェア撮影の証明）
const DIGITAL_CAPTURE_URI = "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture";
const TRAINED_ALGORITHMIC_MEDIA_URI = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";

/**
 * ManifestStoreを解析して、シリアライズ可能なサマリーデータを生成する
 */
export async function createManifestSummary(
  manifestStore: ManifestStore | null | undefined,
  thumbnailUrl: string | null = null
): Promise<C2PASummaryData> {
  // manifestStore自体がnullまたはundefinedの場合
  if (!manifestStore) {
    return {
      activeManifest: null,
      validationStatus: { isValid: false, errors: ['No manifest store found'] },
      thumbnailUrl,
      sourceType: null,
      claimGenerator: null,
      originalClaimGenerator: null,
      originalIssuer: null,
      isTrustedRootIssuer: false,
    };
  }

  const activeManifest = manifestStore.activeManifest;

  if (!activeManifest) {
    return {
      activeManifest: null,
      validationStatus: { isValid: false, errors: ['No active manifest'] },
      thumbnailUrl,
      sourceType: null,
      claimGenerator: null,
      originalClaimGenerator: null,
      originalIssuer: null,
      isTrustedRootIssuer: false,
    };
  }

  // アクティブマニフェストの解析
  const manifestSummary = await parseManifest(activeManifest);

  // 検証ステータス
  const isValid = !manifestStore.validationStatus?.some(s => s.code.startsWith('failure'));
  const errors = manifestStore.validationStatus
    ?.filter(s => s.code.startsWith('failure'))
    .map(s => s.explanation || s.code) || [];

  // サムネイルの処理 (Blob URL -> Data URI)
  // ここでの thumbnailUrl は Active Manifest (Current) のサムネイル
  let finalThumbnailUrl = null;
  if (thumbnailUrl) {
    finalThumbnailUrl = await getBlobUrlAsDataUri(thumbnailUrl);
  } else if (activeManifest.thumbnail) {
    try {
        // DisposableBlobUrl を string に変換
        const blobUrl = (activeManifest.thumbnail.getUrl() as any).url; 
        finalThumbnailUrl = await getBlobUrlAsDataUri(blobUrl);
    } catch (e) {
        console.warn('Failed to get thumbnail from manifest:', e);
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 統合: sourceType と claimGenerator の抽出
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  // sourceType抽出（getSourceTypeロジックを統合）
  let sourceType: string | null = null;
  if (activeManifest.assertions && 'data' in activeManifest.assertions && Array.isArray(activeManifest.assertions.data)) {
    const actionAssertion = activeManifest.assertions.data.find((a: Assertion) =>
      a.label === 'c2pa.actions' || a.label === 'c2pa.actions.v2'
    );

    if (actionAssertion) {
      const data = actionAssertion.data as any;
      const actionsList = data.actions;

      if (Array.isArray(actionsList)) {
        for (const action of actionsList) {
          if (action.digitalSourceType) {
            const typeUri = action.digitalSourceType as string;

            if (typeUri === DIGITAL_CAPTURE_URI) {
              sourceType = "digitalCapture";
              break;
            }

            if (typeUri === TRAINED_ALGORITHMIC_MEDIA_URI || typeUri.includes("trainedAlgorithmicMedia")) {
              sourceType = "trainedAlgorithmicMedia";
              break;
            }

            sourceType = typeUri;
            break;
          }
        }
      }
    }
  }

  // claimGenerator抽出
  const claimGenerator = manifestSummary.claimGenerator;

  // ★追加: Rootマニフェストの特定と情報抽出
  const rootManifest = findRootManifest(activeManifest);

  // RootのClaimGenerator
  const rootGenInfo = rootManifest.claimGeneratorInfo?.[0];
  const originalClaimGenerator = rootManifest.claimGenerator ||
    (rootGenInfo?.name
      ? `${rootGenInfo.name}${rootGenInfo.version ? ' ' + rootGenInfo.version : ''}`
      : 'Unknown');

  // RootのIssuer
  const originalIssuer = rootManifest.signatureInfo?.issuer || 'Unknown';

  // ★追加: Root Issuerが信頼できるかどうかの判定
  const trustedIssuers = getTrustedIssuerNames();
  const isTrustedRootIssuer = trustedIssuers.some(trusted => originalIssuer.includes(trusted));

  console.log(`🔍 Root Manifest Info: Generator="${originalClaimGenerator}", Issuer="${originalIssuer}", Trusted=${isTrustedRootIssuer}`);

  return {
    activeManifest: manifestSummary,
    validationStatus: { isValid, errors },
    thumbnailUrl: finalThumbnailUrl,
    sourceType,
    claimGenerator,
    originalClaimGenerator, // ★追加
    originalIssuer,         // ★追加
    isTrustedRootIssuer,    // ★追加
  };
}

async function parseManifest(manifest: Manifest): Promise<ManifestSummary> {
  // 1. 基本情報
  const signatureInfo = {
    issuer: manifest.signatureInfo?.issuer || 'Unknown',
    time: manifest.signatureInfo?.time || null,
  };

  const trustedIssuers = getTrustedIssuerNames();
  const issuer = signatureInfo.issuer || '';
  const isTrustedIssuer = trustedIssuers.some(trusted => issuer.includes(trusted));

  const generatorInfo = manifest.claimGeneratorInfo?.[0];
  const claimGeneratorInfo = {
    name: generatorInfo?.name || 'Unknown',
    version: generatorInfo?.version || null,
    icon: null,
  };

  // claimGenerator文字列を構築（User Agent形式）
  // manifest.claimGeneratorが存在すればそれを使用、なければclaimGeneratorInfoから構築
  const claimGeneratorString = manifest.claimGenerator ||
    (generatorInfo?.name
      ? `${generatorInfo.name}${generatorInfo.version ? ' ' + generatorInfo.version : ''}`
      : 'Unknown');

  // Credentials の抽出
  const credentials: CredentialSummary[] = manifest.credentials?.map((cred: any) => ({
    url: cred.url || null,
    issuer: cred.issuer || null,
    type: cred.type || null,
  })) || [];

  // Verified Identities の抽出
  const verifiedIdentities: VerifiedIdentitySummary[] = manifest.verifiedIdentities?.map((identity: any) => ({
    name: identity.name || null,
    identifier: identity.identifier || null,
    issuer: identity.issuer || null,
  })) || [];

  // 2. アクション（タイムライン）とAI判定
  let actions: ActionSummary[] = [];
  let isAIGenerated = false;

  // アクションアサーションを取得するヘルパー
  const getActions = (m: Manifest) => {
    if (m.assertions && 'data' in m.assertions && Array.isArray(m.assertions.data)) {
      const actionsAssertion = m.assertions.data.find((a: Assertion) =>
        a.label === 'c2pa.actions' || a.label === 'c2pa.actions.v2'
      );
      // actionsプロパティへのアクセスを許可させるために型アサーションを使用
      return (actionsAssertion?.data as { actions?: unknown[] })?.actions;
    }
    return null;
  };

  const actionsList = getActions(manifest);

  if (actionsList) {
    actions = actionsList.map((action: any) => {
      const digitalSourceType = action.digitalSourceType as string | undefined;
      const description = action.description as string | undefined;
      const actionType = action.action as string | undefined;

      const isAI = 
        digitalSourceType === 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia' ||
        description?.toLowerCase().includes('generative ai') ||
        (actionType === 'c2pa.created' && description?.toLowerCase().includes('google generative ai')); 
      
      if (isAI) isAIGenerated = true;

      return {
        action: actionType || 'unknown',
        description: description || null,
        digitalSourceType: digitalSourceType || null,
        when: action.when as string || null,
      };
    });
  }

  // 3. Ingredients
  const ingredients: IngredientSummary[] = [];
  if (manifest.ingredients) {
    for (const ingredient of manifest.ingredients) {
       ingredients.push({
         title: ingredient.title,
         format: ingredient.format,
         thumbnailUrl: null 
       });
    }
  }

  // 4. その他のアサーション
  const generativeInfo = selectGenerativeInfo(manifest);

  // 5. 全てのassertionsを取得（生データ）
  const allAssertions: Record<string, unknown> = {};

  // AssertionAccessor の data プロパティからアサーションを取得
  if (manifest.assertions && 'data' in manifest.assertions && Array.isArray(manifest.assertions.data)) {
    // assertions.data は Assertion[] 形式
    manifest.assertions.data.forEach((assertion: Assertion) => {
      if (assertion && assertion.label) {
        const label = assertion.label;
        const data = assertion.data || assertion;

        // 同じラベルが複数ある場合は配列に
        if (allAssertions[label]) {
          if (Array.isArray(allAssertions[label])) {
            (allAssertions[label] as unknown[]).push(data);
          } else {
            allAssertions[label] = [allAssertions[label], data];
          }
        } else {
          allAssertions[label] = data;
        }
      }
    });
  }

  // 6. Rootサムネイルの探索 (追加)
  const rootThumbnailBlobUrl = await findRootThumbnail(manifest);
  const rootThumbnailUrl = rootThumbnailBlobUrl ? await getBlobUrlAsDataUri(rootThumbnailBlobUrl) : null;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7. Data Hash の厳格な抽出 (RootLens Spec-Based Extraction)
//
// RootLensでは、デバイスごとの仕様定義 (hash-specs.ts) に基づき、
// 決定論的（Deterministic）に originalHash を抽出します。
// これにより、アサーションの順序や曖昧さに依存せず、常に一意のIDが保証されます。
//
// 抽出プロセス:
//   1. Issuerに基づいてデバイス仕様をマッチング
//   2. 仕様で指定されたC2PA assertionから Data Hash（Hard Binding）を抽出
//   3. Hard Bindingが不在の場合、信頼できるIssuerに限り Instance ID で代用
//
// ※ 定義されていないデバイス（信頼リスト外）の場合、ハッシュは抽出されません。
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  let dataHash: string | null = null;
  
  if (manifest.assertions && 'data' in manifest.assertions && Array.isArray(manifest.assertions.data)) {
    const issuerName = manifest.signatureInfo?.issuer || '';
    
    // 1. スペックのマッチング (Issuerベース)
    let appliedSpec = DEVICE_HASH_SPECS.find(spec => {
      if (spec.matcher instanceof RegExp) {
        return spec.matcher.test(issuerName);
      }
      return issuerName.includes(spec.matcher);
    });

    if (appliedSpec) {
      console.log(`🔍 Applied Hash Spec: [${appliedSpec.vendor}] ${appliedSpec.description} (Target: ${appliedSpec.targetLabels})`);

      // 2. 指定されたラベルのアサーションを検索
      // find() は配列の先頭から検索するため、同名ラベルが複数ある場合は最初のアサーションが選ばれる。
      const hashAssertion = manifest.assertions.data.find((a: any) =>
        appliedSpec!.targetLabels.includes(a.label)
      );

      if (hashAssertion) {
        const rawData = hashAssertion.data as any;

        // 3. ハッシュバイト列の抽出（複数パターン対応）
        // C2PAの実装によって、ハッシュデータの構造が異なるため、
        // 複数のパターンを試行して柔軟に対応します。

        if (rawData?.hash && (Array.isArray(rawData.hash) || rawData.hash instanceof Uint8Array)) {
          // パターンA: { hash: [...] } - 標準的な構造
          dataHash = bytesToHex(rawData.hash);
        } else if (rawData?.val && (Array.isArray(rawData.val) || rawData.val instanceof Uint8Array)) {
          // パターンB: { val: [...] } - 一部の実装で使用
          dataHash = bytesToHex(rawData.val);
        } else if (Array.isArray(rawData) || rawData instanceof Uint8Array) {
          // パターンC: データ自体が配列 - シンプルな構造
          dataHash = bytesToHex(rawData);
        }

        if (dataHash) {
          console.log(`✅ Extracted Data Hash using spec [${appliedSpec.id}]:`, dataHash);
        } else {
          console.warn(`⚠️ Target assertion found (${hashAssertion.label}) but failed to extract bytes. Structure:`, rawData);
        }
      } else {
        console.warn(`⚠️ No matching target assertion found for spec [${appliedSpec.id}]. Searched for: ${appliedSpec.targetLabels.join(', ')}`);
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Fallback: Instance IDによる代用 (Hard Binding不在時の特例措置)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      //
      // 一部のケースでは、明示的なData Hash assertionが存在しない場合があります：
      // 例: Google Pixelの動画スナップショット（構造的結合/Implicit Binding）
      //
      // このような場合でも、Issuerが信頼できる機関（Google LLC等）であれば、
      // C2PAマニフェストの Instance ID を一意識別子として代用します。
      //
      // Instance IDはマニフェストごとに一意であり、改ざんがあれば署名検証で
      // 検出されるため、信頼できるIssuerの場合のみ安全に使用可能です。
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      if (!dataHash) {
        // Issuerが信頼できるかチェック (スペック定義またはグローバル信頼リスト)
        const isTrusted = appliedSpec?.isTrustedIssuer || isTrustedIssuer;

        if (isTrusted) {
          console.warn('⚠️ No explicit Data Hash assertion found, but Issuer is Trusted.');
          console.log('💡 Using Instance ID as a fallback identifier for this file.');

          // Instance IDから 'urn:uuid:' プレフィックスを除去してUUIDを抽出
          const uuid = manifest.instanceId.replace('urn:uuid:', '');

          // 'iid_' プレフィックスでInstance ID由来であることを明示
          dataHash = `iid_${uuid}`;

          console.log(`✅ Using Instance ID as dataHash: ${dataHash}`);
        }
      }

      // 最終検証: ハッシュが抽出できず、かつIssuerも信頼できない場合
      if (!dataHash) {
        console.warn(`⛔ Validation Failed: No Data Hash and Issuer not trusted.`);
      }
    } else {
      console.warn(`⛔ No matching hash spec found for Issuer: "${issuerName}". This issuer is NOT trusted for hash extraction by RootLens.`);
    }
  }

  return {
    label: manifest.label,
    title: manifest.title,
    format: manifest.format,
    vendor: manifest.vendor,
    claimGenerator: claimGeneratorString,
    claimGeneratorInfo,
    claimGeneratorHints: manifest.claimGeneratorHints,
    instanceId: manifest.instanceId,
    signatureInfo,
    credentials,
    producer: selectProducer(manifest) ? { name: selectProducer(manifest)!.name } : null,
    ingredients,
    redactions: manifest.redactions || [],
    assertions: {
      generativeInfo,
      exif: null,
      actions,
      allAssertions,
    },
    isAIGenerated,
    dataHash, // 追加
    rootThumbnailUrl,
    verifiedIdentities,
    cawgIssuers: manifest.cawgIssuers || [],
    isTrustedIssuer, // 追加
  };
}

// Rootマニフェストを再帰的に探すヘルパー
function findRootManifest(manifest: Manifest, depth = 0): Manifest {
  if (depth > 10) return manifest; // 深さ制限

  // Ingredientsがない = Root
  if (!manifest.ingredients || manifest.ingredients.length === 0) {
    return manifest;
  }

  // 親を探す (ingredients[0] を優先)
  const parentIngredient = manifest.ingredients[0];

  // 親マニフェストがある場合、さらに潜る
  if (parentIngredient?.manifest) {
    return findRootManifest(parentIngredient.manifest, depth + 1);
  }

  // 親がなければ現在のマニフェストがRoot
  return manifest;
}

// Rootサムネイルを再帰的に探すヘルパー
async function findRootThumbnail(manifest: Manifest, depth = 0): Promise<string | null> {
  if (depth > 10) return null; // 深さ制限

  // Ingredientsがない = Rootの可能性
  if (!manifest.ingredients || manifest.ingredients.length === 0) {
    try {
      return (manifest.thumbnail?.getUrl() as any).url || null;
    } catch {
      return null;
    }
  }

  // 親を探す (ingredients[0] を優先)
  const parentIngredient = manifest.ingredients[0];

  // 親マニフェストがある場合、さらに潜る
  if (parentIngredient?.manifest) {
    const parentThumbnail = await findRootThumbnail(parentIngredient.manifest, depth + 1);
    if (parentThumbnail) return parentThumbnail;
  }

  // 親から取れなかったが、Ingredient自体がサムネイルを持っている場合
  if (parentIngredient?.thumbnail) {
      try {
          return (parentIngredient.thumbnail.getUrl() as any).url;
      } catch {
          // ignore
      }
  }

  // ここまで来て見つからなければ、現在のマニフェストのサムネイルを返す（救済策）
  // 途切れたチェーンの最深部
  try {
    return (manifest.thumbnail?.getUrl() as any).url || null;
  } catch {
    return null;
  }
}

// ... (existing code)

// Helper: Blob URL to Data URI
async function getBlobUrlAsDataUri(blobUrl: string | Blob): Promise<string | null> {
  let url: string = '';
  if (typeof blobUrl === 'string') {
    url = blobUrl;
  } else if (blobUrl instanceof Blob) {
    url = URL.createObjectURL(blobUrl);
  } else if (typeof blobUrl === 'object' && blobUrl !== null && 'url' in blobUrl && typeof (blobUrl as any).url === 'string') {
    url = (blobUrl as any).url;
  } else {
    return null; // 不明な型の場合はnullを返す
  }

  if (!url.startsWith('blob:')) return url; // blob: ではない場合はそのまま返す
  
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = (e) => {
        console.error('   FileReader error:', reader.error);
        resolve(null);
      };
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error('❌ Failed to convert blob URL to Data URI:', e);
    return null;
  } finally {
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url); // オブジェクトURLを解放
    }
  }
}

/**
 * Source Type URIから表示用ラベルとハードウェア撮影判定を取得する
 */
export function getSourceTypeLabel(uri: string | null | undefined): { label: string; isHardware: boolean } {
  if (!uri) return { label: 'Unknown', isHardware: false };

  // URIから末尾のキーを取得
  const key = uri.split('/').pop() || uri;

  switch (key) {
    case 'digitalCapture':
      return { label: 'Digital Capture', isHardware: true };
    case 'computationalCapture':
      return { label: 'Computational Capture', isHardware: true };
    case 'multipleExposures':
      return { label: 'Multiple Exposures', isHardware: true };
    case 'trainedAlgorithmicMedia':
      return { label: 'AI Generated', isHardware: false };
    case 'compositeSynthetic':
      return { label: 'Composite / Synthetic', isHardware: false };
    case 'algorithmicMedia':
      return { label: 'Algorithmic Media', isHardware: false };
    case 'softwareImage':
      return { label: 'Software Image', isHardware: false };
    case 'virtualRecording':
      return { label: 'Virtual Recording', isHardware: false };
    case 'scannedImage':
      return { label: 'Scanned Image', isHardware: false };
    default:
      return { label: key, isHardware: false };
  }
}