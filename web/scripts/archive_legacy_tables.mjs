// 死骸テーブルの退避ダンプ。 0005_drop_legacy_tables.sql の前に実行する。
//
// 各テーブルの全行を JSON で <repo>/backups/<UTC日時>_<table>.json に書き出す (読み取りのみ)。
// backups/ は gitignore 済み (= データはリポジトリに入れない)。
//
//   node scripts/archive_legacy_tables.mjs

import { config } from "dotenv";
import postgres from "postgres";
import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
config({ path: join(root, ".env.local") });
config({ path: join(root, ".env") });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set (.env.local / .env)");
  process.exit(1);
}

const TABLES = ["cnft_assets", "device_certificates", "contents", "pages", "users"];

const sql = postgres(process.env.DATABASE_URL, { prepare: false });
const outDir = join(root, "..", "backups");
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

for (const table of TABLES) {
  const rows = await sql.unsafe(`select * from ${table}`);
  const path = join(outDir, `${stamp}_${table}.json`);
  writeFileSync(path, JSON.stringify(rows, null, 1));
  console.log(`${table.padEnd(22)} ${rows.length} 行 → ${path}`);
}

await sql.end();
console.log("アーカイブ完了。 この後 0005_drop_legacy_tables.sql を流してよい。");
