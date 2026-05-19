// 派生 C2PA manifest (= 「署名 B」) 生成。
//
// SPECS_JA §6.2 ステップ 3 で、 ぼかし済 MCAP に新しい C2PA manifest を作る:
//   - 元の生 MCAP を embedded ingredient として参照
//   - ぼかしルールを actions として記録 (= c2pa.placed.face_blur 等)
//   - RootLens サーバ証明書で manifest 全体を署名
//
// 本来 c2pa-rs (Rust) を node binding で呼ぶか、 Modal 内で Python から扱うのが筋。
// MVP では interface だけ定義して、 実装は後で c2pa-rs binding を作る。

export interface IngredientManifestInput {
  /// 元の生 MCAP の sha256 (hex)
  contentHash: string;
  /// 端末 TEE が付けた C2PA manifest 全体 (= JUMBF box の raw bytes、 base64)
  signedManifestBase64: string;
}

export interface DeriveManifestRequest {
  /// ぼかし済 MCAP の R2 オブジェクトキー (= サーバが R2 から fetch して manifest を埋め込む)
  blurredR2Key: string;
  /// ぼかし済 MCAP の sha256 (hex)
  blurredContentHash: string;
  /// 元 manifest (= 署名 A) を ingredient として埋め込むための入力
  ingredient: IngredientManifestInput;
  /// ぼかしの action ID (= 現状 c2pa.placed.face_blur のみ。 §2.10 参照)
  actions: Array<{
    actionId: string;
    description?: string;
  }>;
}

export interface DeriveManifestResult {
  /// 署名 B が埋め込まれた MCAP の R2 オブジェクトキー (= blurredR2Key と同じ場合もある)
  signedR2Key: string;
  /// 署名 B が埋め込まれた MCAP の sha256 (hex)。 manifest を埋め込んだ後は contentHash が変わる
  finalContentHash: string;
}

/// MVP stub。 c2pa-rs FFI ができたらここを差し替える。
/// 現状: 入力を返すだけで何もしない (= signedR2Key = blurredR2Key、 hash も同じ)。
/// 本実装では c2pa-rs の sign_async + Ingredient::from_manifest_bytes で署名 B を作って、
/// MCAP の JUMBF box に埋め込み、 R2 に再 PUT する。
export async function deriveAndSignManifest(req: DeriveManifestRequest): Promise<DeriveManifestResult> {
  console.warn("[c2pa] deriveAndSignManifest is a stub. Returning input unchanged.");
  return {
    signedR2Key: req.blurredR2Key,
    finalContentHash: req.blurredContentHash,
  };
}
