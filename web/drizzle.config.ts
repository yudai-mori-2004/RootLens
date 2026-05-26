import { defineConfig } from "drizzle-kit";
import { config as loadEnv } from "dotenv";

// drizzle-kit CLI 設定。 Next.js と違って .env.local の自動 load が無いので明示的に読む。
// .env.local 優先、 fallback で .env。

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // Supabase の auth / storage 等の他スキーマを pull しないように public に限定。
  // 限定しないと drizzle-kit が他スキーマの特殊 check constraint を parse できず内部例外で死ぬ。
  schemaFilter: ["public"],
});
