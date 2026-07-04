import { NativeModules, Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

// 仕様書 §4.6.2 ネイティブモジュールIF
// React Native JS層にはTEE操作やC2PA構造の詳細を一切露出させない

// 仕様書 §4.5 C2PAマニフェスト読み取り結果
export interface C2paManifestInfo {
  has_manifest: boolean;
  /** 暗号検証に致命的失敗がないか (mismatch/failure系がなければtrue) */
  is_valid?: boolean;
  signer_common_name?: string;
  /** 署名者のOrganization。信頼リスト判定に使用 */
  signer_org?: string;
  claim_generator?: string;
  validation_status?: Array<{
    code: string;
    url?: string;
    explanation?: string;
  }>;
  error?: string;
}

export interface MaskRect {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

export interface VideoProcessOptions {
  cropX?: number;
  cropY?: number;
  cropW?: number;
  cropH?: number;
  outputW?: number;
  outputH?: number;
  startMs?: number;
  endMs?: number;
}

/**
 * C2PA Custom Assertion (v0.1.1)。
 *  - label: assertion ラベル (例: "io.rootlens.capture.ios.core_motion.gyro")
 *  - data: assertion 本体 (任意 JSON-serializable; sensor 取得結果をそのまま入れる)
 */
export interface C2paAssertion {
  label: string;
  data: unknown;
}

interface C2paBridgeInterface {
  // v0.1.1: assertions 配列を受け取る (省略可。空 / undefined なら追加なし)
  signContent(imagePath: string, assertions?: C2paAssertion[]): Promise<string>;
  readManifest(imagePath: string): Promise<string>;
  applyMasks(imagePath: string, masks: MaskRect[]): Promise<string>;
  processVideo(inputPath: string, optionsJson: string): Promise<string>;
  getVersion(): Promise<string>;
  // §4.4 TEE鍵管理
  // v0.1.3 Pipeline 1 (= mock-device 互換 D1/D2/signature_hash)
  signD1(inputMp4: string, outputMp4: string): Promise<string>;
  signD2(blurredMp4: string, parentD1Mp4: string, outputMp4: string, facesBlurred: number, blurAssertionJson: string): Promise<string>;
  computeContentId(inputMp4: string): Promise<string>;
}

// Expo Modules API (iOS) or legacy NativeModules (Android)
let C2paBridge: C2paBridgeInterface | null = null;
try {
  C2paBridge = requireNativeModule('C2paBridge');
} catch {
  // Expo module not available, try legacy NativeModules (Android)
  C2paBridge = NativeModules.C2paBridge ?? null;
}

/**
 * C2PA 署名を実行する。
 *
 * v0.1.1 で `assertions` を追加: 撮影時に取得した sensor 取得結果などを
 * 任意の C2PA assertion として注入できる。`c2pa.actions.created` と並ぶ追加 assertion になる。
 * undefined / 空配列を渡せば従来同様 `c2pa.actions.created` のみで署名する。
 *
 * v0.1.1 で signContentWithParent (parent ingredient 参照) を完全削除。
 * EditScreen 撤去に伴い来歴チェーンの編集アクションは v0.1.1 では発生しない。
 *
 * @param imagePath 入力画像のパス
 * @param assertions 追加 assertion 配列 (省略可)
 * @returns 署名済みファイルのパス
 */
export async function signContent(
  imagePath: string,
  assertions?: C2paAssertion[]
): Promise<string> {
  if (!C2paBridge) {
    throw new Error(
      `C2paBridge native module is not available on ${Platform.OS}`,
    );
  }
  return C2paBridge.signContent(imagePath, assertions);
}

/**
 * C2PAマニフェストを読み取る
 * 仕様書 §4.5 C2PAマニフェスト読み取り
 * @param imagePath 入力画像のパス
 * @returns マニフェスト情報
 */
export async function readManifest(imagePath: string): Promise<C2paManifestInfo> {
  if (!C2paBridge) {
    return { has_manifest: false, error: `C2paBridge not available on ${Platform.OS}` };
  }
  try {
    const json = await C2paBridge.readManifest(imagePath);
    return JSON.parse(json) as C2paManifestInfo;
  } catch (e) {
    return { has_manifest: false, error: String(e) };
  }
}

/**
 * 画像にマスク（黒塗り矩形）を描画する
 * @param imagePath 入力画像のパス
 * @param masks マスク矩形の配列（ピクセル座標）
 * @returns マスク適用済み画像のパス
 */
export async function applyMasks(imagePath: string, masks: MaskRect[]): Promise<string> {
  if (!C2paBridge) {
    throw new Error(`C2paBridge native module is not available on ${Platform.OS}`);
  }
  return C2paBridge.applyMasks(imagePath, masks);
}

/**
 * 動画にクロップ・リサイズ・トリムを適用する
 * @param inputPath 入力動画のパス
 * @param options 処理オプション（クロップ座標、出力サイズ、トリム範囲）
 * @returns 処理済み動画のパス
 */
export async function processVideo(inputPath: string, options: VideoProcessOptions): Promise<string> {
  if (!C2paBridge) {
    throw new Error(`C2paBridge native module is not available on ${Platform.OS}`);
  }
  return C2paBridge.processVideo(inputPath, JSON.stringify(options));
}

/**
 * c2pa-bridgeのバージョンを返す
 */
export async function getVersion(): Promise<string> {
  if (!C2paBridge) {
    return 'not available';
  }
  return C2paBridge.getVersion();
}

// ─── v0.1.3 Pipeline 1 ──────────────────────────────────────────────────
// mock-device の C2PA 2 段署名 + signature_hash 抽出を iOS 上で再現する。
// DATA_SPECS §2.4 / §1.1 を参照。

/// D1 署名: 生 MP4 → c2pa.actions.v2 [c2pa.created] の C2PA manifest 付き MP4 を出力。
export async function signD1(inputMp4: string, outputMp4: string): Promise<string> {
  if (!C2paBridge) throw new Error('C2paBridge native module not available');
  return C2paBridge.signD1(inputMp4, outputMp4);
}

/// D2 署名: ぼかし済 MP4 と親 D1 MP4 を渡し、 ingredient parentOf で D1 を参照する
/// D2 C2PA manifest 付き MP4 を出力する。
export async function signD2(
  blurredMp4: string,
  parentD1Mp4: string,
  outputMp4: string,
  facesBlurred: number,
  /// io.rootlens.privacy.blur.v1 の data (per-frame 顔 bbox) の JSON 文字列。 空なら assertion を付けない。
  blurAssertionJson = '',
): Promise<string> {
  if (!C2paBridge) throw new Error('C2paBridge native module not available');
  return C2paBridge.signD2(blurredMp4, parentD1Mp4, outputMp4, facesBlurred, blurAssertionJson);
}

/// signature_hash = SHA-256(active manifest signature)。 "sha256:<64 hex>" を返す。
/// "sha256:" prefix を除いた hex 64 文字部分が DB / R2 key で使う form (DATA_SPECS §1.1)。
/// native FFI のメソッド名は computeContentId のまま (= native 側のリネームは別フェーズ)。
export async function computeSignatureHash(inputMp4: string): Promise<string> {
  if (!C2paBridge) throw new Error('C2paBridge native module not available');
  return C2paBridge.computeContentId(inputMp4);
}
