// クリップ ID 生成。
//
// 形式: `clip_<signature_hash 12 文字>_<unixms base36>`
// signature_hash は端末で確定する 32 byte hex (= D2 active manifest signature の SHA-256)。
// その先頭 12 文字 + 行作成時刻 (= unix ms) で衝突しない値を作る。
//
// 主キーとしては DB の `id` カラムに入る不変識別子。 同 wallet × 同 signature_hash の重複は
// 既存行を返す idempotent な POST /api/clips で処理する。

export function makeClipId(signatureHash: string): string {
  return `clip_${signatureHash.slice(0, 12)}_${Date.now().toString(36)}`;
}
