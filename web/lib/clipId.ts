// クリップ ID 生成。
//
// 形式: `clip_<content_id 12 文字>_<unixms base36>`
// content_id は端末で確定する 32 byte hex (= D2 active manifest signature の SHA-256)。
// その先頭 12 文字 + 行作成時刻 (= unix ms) で衝突しない値を作る。
//
// 主キーとしては DB の `id` カラムに入る不変識別子。 同 wallet × 同 content_id の重複は
// 既存行を返す idempotent な POST /api/clips で処理する。

export function makeClipId(contentId: string): string {
  return `clip_${contentId.slice(0, 12)}_${Date.now().toString(36)}`;
}
