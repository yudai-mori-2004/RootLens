import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Neon HTTP driver + Drizzle ORM。
// HTTP ベースなので Vercel Function 毎呼出で新規接続 (= connection pool 不要)。
// 単発 SELECT / INSERT には最適。 long transaction が要る場合は neon-serverless に切り替える。
//
// 環境変数 DATABASE_URL は Vercel Marketplace 経由で Neon を provision すると自動 set される。

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Provision Neon via Vercel Marketplace or set manually.");
}

const sql = neon(process.env.DATABASE_URL);
export const db = drizzle(sql, { schema });

export { schema };
