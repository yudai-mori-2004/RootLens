-- v0.1.3: rootAssetId / signedJsonUri を Pipeline 2 起動の前提条件として notNull 化する。
-- 旧 nullable 行 (= v0.1.3 cleanup 前の smoke で作った行) は削除してから ALTER する。
-- production data はまだ無いので drop で問題なし。
DELETE FROM "clips" WHERE "root_asset_id" IS NULL OR "signed_json_uri" IS NULL;--> statement-breakpoint
ALTER TABLE "clips" ALTER COLUMN "root_asset_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "clips" ALTER COLUMN "signed_json_uri" SET NOT NULL;