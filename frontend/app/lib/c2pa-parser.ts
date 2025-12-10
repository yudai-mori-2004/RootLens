// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// C2PA Manifest Parser (Inspired by verify-site)
// ManifestStoreから表示用サマリーデータを抽出するユーティリティ
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import {
  selectGenerativeInfo,
  selectProducer,
  type Manifest,
  type ManifestStore,
} from 'c2pa';

export interface C2PASummaryData {
  activeManifest: ManifestSummary | null;
  validationStatus: ValidationSummary;
  thumbnailUrl: string | null;
}

export interface ManifestSummary {
  label: string;
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
    generativeInfo: any | null;
    exif: any | null;
    actions: ActionSummary[];
    allAssertions: Record<string, any>; // 全てのassertion（生データ）
  };
  isAIGenerated: boolean;
  rootThumbnailUrl: string | null; // 追加: Root（始祖）のサムネイル
  verifiedIdentities: VerifiedIdentitySummary[];
  cawgIssuers: string[];
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
    };
  }

  const activeManifest = manifestStore.activeManifest;

  if (!activeManifest) {
    return {
      activeManifest: null,
      validationStatus: { isValid: false, errors: ['No active manifest'] },
      thumbnailUrl,
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
        const blobUrl = activeManifest.thumbnail.getUrl();
        finalThumbnailUrl = await getBlobUrlAsDataUri(blobUrl);
    } catch (e) {
        console.warn('Failed to get thumbnail from manifest:', e);
    }
  }

  return {
    activeManifest: manifestSummary,
    validationStatus: { isValid, errors },
    thumbnailUrl: finalThumbnailUrl,
  };
}

async function parseManifest(manifest: Manifest): Promise<ManifestSummary> {
  // 1. 基本情報
  const signatureInfo = {
    issuer: manifest.signatureInfo?.issuer || 'Unknown',
    time: manifest.signatureInfo?.time || null,
  };

  const generatorInfo = manifest.claimGeneratorInfo?.[0];
  const claimGeneratorInfo = {
    name: generatorInfo?.name || 'Unknown',
    version: generatorInfo?.version || null,
    icon: null,
  };

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
    // AssertionAccessorの data プロパティから取得
    if (m.assertions && 'data' in m.assertions && Array.isArray(m.assertions.data)) {
      const actionsAssertion = m.assertions.data.find((a: any) =>
        a.label === 'c2pa.actions' || a.label === 'c2pa.actions.v2'
      );
      return actionsAssertion?.data?.actions;
    }
    return null;
  };

  const actionsList = getActions(manifest);

  if (actionsList) {
    actions = actionsList.map((action: any) => {
      const isAI = 
        action.digitalSourceType === 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia' ||
        action.description?.toLowerCase().includes('generative ai') ||
        (action.action === 'c2pa.created' && action.description?.toLowerCase().includes('google generative ai')); 
      
      if (isAI) isAIGenerated = true;

      return {
        action: action.action,
        description: action.description || null,
        digitalSourceType: action.digitalSourceType || null,
        when: action.when || null,
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
  const allAssertions: Record<string, any> = {};

  // AssertionAccessor の data プロパティからアサーションを取得
  if (manifest.assertions && 'data' in manifest.assertions && Array.isArray(manifest.assertions.data)) {
    // assertions.data は Assertion[] 形式
    manifest.assertions.data.forEach((assertion: any) => {
      if (assertion && assertion.label) {
        const label = assertion.label;
        const data = assertion.data || assertion;

        // 同じラベルが複数ある場合は配列に
        if (allAssertions[label]) {
          if (Array.isArray(allAssertions[label])) {
            allAssertions[label].push(data);
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

  return {
    label: manifest.label,
    title: manifest.title,
    format: manifest.format,
    vendor: manifest.vendor,
    claimGenerator: manifest.claimGenerator,
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
    rootThumbnailUrl,
    verifiedIdentities,
    cawgIssuers: manifest.cawgIssuers || [],
  };
}

// Rootサムネイルを再帰的に探すヘルパー
async function findRootThumbnail(manifest: Manifest, depth = 0): Promise<string | null> {
  if (depth > 10) return null; // 深さ制限

  // Ingredientsがない = Rootの可能性
  if (!manifest.ingredients || manifest.ingredients.length === 0) {
    try {
      return manifest.thumbnail?.getUrl() || null;
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
          return parentIngredient.thumbnail.getUrl();
      } catch {
          // ignore
      }
  }

  // ここまで来て見つからなければ、現在のマニフェストのサムネイルを返す（救済策）
  // 途切れたチェーンの最深部
  try {
    return manifest.thumbnail?.getUrl() || null;
  } catch {
    return null;
  }
}

// Helper: Blob URL to Data URI
async function getBlobUrlAsDataUri(blobUrl: string | any): Promise<string | null> {
  let url = blobUrl;
  if (typeof blobUrl === 'object' && blobUrl !== null && 'url' in blobUrl) {
      url = blobUrl.url;
  }

  if (typeof url !== 'string' || !url.startsWith('blob:')) return url; 
  
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
  }
}