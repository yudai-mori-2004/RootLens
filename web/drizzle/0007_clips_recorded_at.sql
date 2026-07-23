-- 録画開始時刻。 raw rgb.mp4 の QuickTime ヘッダ (mvhd creation_time) 由来の壁時計 (UTC)。
-- created_at (= 登録 ≒ アップロード完了) とは別物で、 現場では撮影から数十時間後に
-- まとめてアップロードされることがある (実測で最大 58 時間差)。
-- 納品パイプラインが raw を読むついでに埋める。 nullable = まだ読んでいない行。

BEGIN;

ALTER TABLE clips ADD COLUMN recorded_at timestamptz;

COMMIT;
