import { defineConfig } from "drizzle-kit";
import { config as loadEnv } from "dotenv";

// drizzle-kit の設定。
// 開発時:
//   npx drizzle-kit generate   schema 変更から migration SQL を生成
//   npx drizzle-kit push       Neon DB に直接 push (dev のみ推奨)
//   npx drizzle-kit studio     ブラウザで DB の中身を眺める
//
// drizzle-kit は CLI なので Next.js のような .env.local 自動 load が無い。
// 明示的に .env.local → .env の順で load する (= .env.local を優先)。
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
