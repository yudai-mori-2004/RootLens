import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

// Supabase Postgres へ postgres-js + Drizzle ORM で接続。
//
// Vercel Serverless / Modal で複数並列接続するので Supabase の Transaction Pooler URL を推奨。
// Transaction Pooler は prepared statement に対応しないため、 postgres-js で prepare: false を指定。
// (Session pooler や Direct connection を使う場合は prepare: true で問題ない)
//
// 環境変数:
//   DATABASE_URL = Supabase の接続文字列 (= "postgres://postgres.<ref>:<password>@<host>:6543/postgres")

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Use Supabase Transaction Pooler URL.");
}

const client = postgres(process.env.DATABASE_URL, {
  prepare: false,
});

export const db = drizzle(client, { schema });
export { schema };
