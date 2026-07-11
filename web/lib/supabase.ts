// Supabase service role クライアント (= サーバ専用シングルトン)。
//
// 用途は 2 つだけ:
//   1. API ルートでの Bearer JWT 検証 (auth.getUser(token))
//   2. 運用スクリプトでのアカウント発行 / 停止 (auth.admin.*)
//
// アカウントの意味論 (現場名・契約・振込先) は DB に置かない方針 (task 13)。
// auth.users が持つのは合成メール (<handle>@rl.local) と uuid だけで、 PII は存在しない。

import { createClient } from "@supabase/supabase-js";

const url =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
}

export const supabaseAdmin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
