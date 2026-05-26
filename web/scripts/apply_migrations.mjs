// drizzle/ 配下の SQL migration を Supabase に逐次 apply する。
//
// drizzle-kit push が Supabase の auth/storage 等の他スキーマ introspection で内部バグを踏むため、
// generate で吐いた SQL を postgres-js で直接 execute する経路を取る。
//
// 使い方:
//   node scripts/apply_migrations.mjs
//
// 冪等性: CREATE TABLE は IF NOT EXISTS を付けていないので、 2 回目は既存 table のため fail する。
// dev 環境のリセットには Supabase dashboard で table drop してから再実行。

import { config } from "dotenv";
import postgres from "postgres";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoServerRoot = join(__dirname, "..");

config({ path: join(repoServerRoot, ".env.local") });
config({ path: join(repoServerRoot, ".env") });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set. Set in .env or .env.local.");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false });

const migrationDir = join(repoServerRoot, "drizzle");
const files = readdirSync(migrationDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

console.log(`Found ${files.length} migration(s) in ${migrationDir}`);

for (const f of files) {
  console.log(`\n=== ${f} ===`);
  const script = readFileSync(join(migrationDir, f), "utf8");
  const statements = script
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    const preview = stmt.slice(0, 80).replace(/\n/g, " ");
    console.log(`  exec: ${preview}${stmt.length > 80 ? "..." : ""}`);
    try {
      await sql.unsafe(stmt);
    } catch (e) {
      console.error(`  FAILED: ${e.message}`);
      await sql.end();
      process.exit(1);
    }
  }
}

await sql.end();
console.log("\nmigrations applied successfully");
