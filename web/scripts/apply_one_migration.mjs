// 単一の drizzle migration を Supabase に適用する (= 増分マイグレーション用)。
//
// apply_migrations.mjs は drizzle/ 配下の全 .sql を流すため、 0000 (= CREATE TABLE、
// IF NOT EXISTS なし) で既存 DB に当たって落ちる。 増分の 1 本だけ流したい時はこちらを使う。
//
// 使い方:
//   node scripts/apply_one_migration.mjs 0003_content_hash_and_account.sql

import { config } from "dotenv";
import postgres from "postgres";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
config({ path: join(root, ".env.local") });
config({ path: join(root, ".env") });

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/apply_one_migration.mjs <file.sql>");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set (.env.local / .env)");
  process.exit(1);
}

// max: 1 = 単一コネクション。 migration ファイル内の BEGIN/COMMIT を postgres.js の
// UNSAFE_TRANSACTION ガードに弾かせないため (トランザクションはファイル側が宣言する)。
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const script = readFileSync(join(root, "drizzle", file), "utf8");
const statements = script
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

console.log(`Applying ${file} (${statements.length} statement(s))`);
for (const stmt of statements) {
  const preview = stmt.slice(0, 90).replace(/\n/g, " ");
  console.log(`  exec: ${preview}${stmt.length > 90 ? "..." : ""}`);
  try {
    await sql.unsafe(stmt);
  } catch (e) {
    console.error(`  FAILED: ${e.message}`);
    await sql.end();
    process.exit(1);
  }
}

await sql.end();
console.log("migration applied successfully");
