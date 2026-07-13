// API 認証。
//
// `Authorization: Bearer <supabase JWT>` を検証して account_id (= auth.users.id の uuid)
// を返す。 クライアント申告の id は一切信用しない (= 識別子は必ず検証済みトークンの sub)。

import { supabaseAdmin } from "./supabase";

function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Bearer JWT を検証して account_id (uuid) を返す。 失敗時は Response を throw する
 * (= 呼び出し側は `catch (r) { return r as Response }` で返す)。
 */
export async function requireAccountId(req: Request): Promise<string> {
  const auth = req.headers.get("authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    throw unauthorized("Authorization: Bearer <token> required");
  }
  const token = auth.slice("Bearer ".length).trim();

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    throw unauthorized("invalid or expired token");
  }
  return data.user.id;
}
