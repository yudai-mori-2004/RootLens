# 06. E2E smoke（1 クリップ通過確認）

## 目的

実機で v0.1.4 の最短フローを 1 周通し、 R2 と DB の中身を実測検証する。 これで v0.1.4 の MVP として
「測れて溜まる」 状態になる。

## 読むべきファイル

- `document/v0.1.4/DATA_SPECS_JA.md` 全体
- `tools/smoke-test.sh`（v0.1.3 系。 v0.1.4 用に簡素化が要る可能性あり）

## スコープ

### やること

1. **新規録画**（実機）: 撮影画面で ultra_wide で 30 秒程度撮影、 録画停止 → 自動アップロード →
   state='uploaded' を画面で確認。
2. **arkit 構成切替確認**: 構成スイッチャで arkit に切替えてもう 1 クリップ撮影、 同様に uploaded まで。
3. **R2 確認**:
   - `raw/<signature_hash>/` に `rgb.mp4` + `realtime_handpose.jsonl` + `metadata.json`
     + （arkit なら）`imu.jsonl` が並ぶ。
   - `rgb.mp4` を `c2patool` で叩いて C2PA D1 manifest が 1 つだけ（D2 と blur assertion が無い）+
     `assertion.bmffHash.match` + 証明書 `O=RootLens`、 唯一の失敗が `signingCredential.untrusted`
     （= dev cert）であることを確認。
   - `rgb.mp4` を ffprobe で見て **blur されていない**（実映像で顔が見える）こと確認。
4. **DB 確認**: clips 行が `state='uploaded'` + 削除した列が存在しない（= migration 適用済み）。
5. **processed/ が空**であることを確認（= Pipeline 2/3 が動いていない）。

### やらないこと

- 後段ワーカー（blur / scoring / labeling / mint）の手動実行。
- 長尺（30 分超）テスト。 30 分上限はそもそも v0.1.4 では機能要件外（後段の制約は外したため）。
- 性能計測（後段ワーカー再配線後にやる）。

## 成功基準

- 2 つの撮影構成（ultra_wide / arkit）で 1 クリップずつ通過。
- 各 raw/<hash>/ が DATA_SPECS §2.4 のファイル集合と一致。
- C2PA D1 only manifest、 BMFF hash 一致、 blur 無し。
- DB state='uploaded'、 削除列無し、 processed/ 空。

## 進捗

- [ ] ultra_wide 1 クリップ通過
- [ ] arkit 1 クリップ通過
- [ ] R2 / DB / C2PA 実測確認
