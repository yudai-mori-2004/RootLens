// MVP 認証ラッパ。
//
// アカウント公開鍵 (= 端末が持つ Ed25519 鍵の base58) を X-Account-Pubkey ヘッダから取る。
// 本実装では鍵署名で challenge-response を行う予定。 MVP では header の生値を信用する
// (= demo / dev 限定、 production 移行前に必ず差し替え)。

export function requireAccountPubkey(req: Request): string {
  const pubkey = req.headers.get("x-account-pubkey");
  if (!pubkey) {
    throw new Response(JSON.stringify({ error: "X-Account-Pubkey header required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  // Ed25519 pubkey は base58 で 32-44 文字
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(pubkey)) {
    throw new Response(JSON.stringify({ error: "Invalid account pubkey format" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  return pubkey;
}
