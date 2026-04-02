-- 仕様書 §7.1 公開ページ — キャプションフィールド追加
-- 投稿者が自由に記述するテキスト（Instagram的キャプション）

alter table pages add column if not exists caption text;
