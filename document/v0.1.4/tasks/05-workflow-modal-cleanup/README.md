# 05. Workflow / Modal の切り離し

## 目的

サーバ側の自動処理パイプライン（WDK workflow + Modal の Pipeline 2/3 関数）をアプリの流れから切り離す。
コードはリポに残しつつ、 自動トリガーと Modal deployment を停止する（v0.1.5 で後段ワーカーとして
再配線する時にリファレンスにする）。

## 読むべきファイル

- `web/workflow/process-clip.ts`（POST /api/clips/:id/finalize で起動していた workflow）
- `web/lib/modal.ts`（callMetadataScore / callFrameSampling / callVlmScore / callWilor）
- `tools/modal/layer1_metadata.py` / `layer2_frame_sampling.py` / `layer3_vlm.py` / `wilor.py`
- `tools/modal/labeling/`（gemini-video-dense 等、 残置）

## スコープ

### やること

1. **`web/workflow/process-clip.ts` を削除**（finalize エンドポイントが消えるので呼び出し元無し）。
   または「v0.1.5 で再配線」 とコメントを付けて関数だけ残置（最終決定は実装時に）。
2. **`web/lib/modal.ts` の Modal 呼び出し関数**は削除または無効化。 web 側で参照が消える。
3. **Modal deployment を teardown**:
   - `modal app stop rootlens-layer1-metadata`
   - `modal app stop rootlens-layer2-frame-sampling`
   - `modal app stop rootlens-layer3-vlm`
   - `modal app stop rootlens-wilor`
   - これでサーバ側で動いている Pipeline 2/3 が完全に止まる。
4. **`tools/modal/*.py` のソースは残す**（v0.1.5 でリファレンスとして再利用）。 README に「v0.1.4 では未配線」
   コメントを追加。
5. `web` の `npx tsc --noEmit` が green。

### やらないこと

- Modal app の **完全削除**（= リポから rm）。 ソースは v0.1.5 で再利用するため残す。
- `tools/modal/labeling/` の再設計（gemini-video-dense の API は次バージョンで使い回せる）。
- 別の後段ワーカー（blur / scoring 等）の事前構築。 v0.1.5 で別タスクとして起こす。

## 成功基準

- `process-clip.ts` 削除 or 無効化、 `finalize` endpoint から呼ばれていた経路がコードレベルで断たれている。
- Modal dashboard 上で 4 つの app が stopped 状態（または deploy 自体が無い）。
- `web` 側 tsc green。

## 進捗

- [x] `web/workflow/process-clip.ts` + `web/workflow/` 削除
- [x] `web/lib/modal.ts` 削除（呼び出し元なし）
- [ ] Modal app stop（= 手動。 実際の deploy 名は `rootlens-pipeline2` + `rootlens-wilor` の 2 本:
      `modal app stop rootlens-pipeline2 && modal app stop rootlens-wilor`）
- [x] tools/modal/ ソース残置（v0.1.5 で再利用）
- [x] tsc green
