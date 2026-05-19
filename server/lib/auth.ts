// MVP の認証ラッパ。
//
// Solana wallet pubkey を X-Wallet-Pubkey ヘッダから取る。
// 本実装では wallet 署名で証明を取って authenticated 化する (= challenge-response)。
// MVP では header の生値を信用する (= demo / dev 限定、 production 移行前に必ず差し替え)。

export function requireWalletPubkey(req: Request): string {
  const pubkey = req.headers.get("x-wallet-pubkey");
  if (!pubkey) {
    throw new Response(JSON.stringify({ error: "X-Wallet-Pubkey header required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  // 簡易な形式チェック (= Solana pubkey は base58 で 32-44 文字)
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(pubkey)) {
    throw new Response(JSON.stringify({ error: "Invalid wallet pubkey format" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  return pubkey;
}
