// TP Gateway の base URL は env 一本 (= TP_GATEWAY_URL) を真実とする。
//
// ハードコードの IP fallback は持たない。 EC2 を停止/起動すると公開 IP が変わるので、
// コードに IP を焼くと再起動のたびに壊れる。 IP が変わったら Vercel の TP_GATEWAY_URL を
// 更新するだけで全ルート (tp-mint-tx / tp-process / tp-proxy) が追従する。
// (恒久的に固定したいなら EC2 に Elastic IP を割り当てて、 その IP を env に入れる)。
//
// 例: TP_GATEWAY_URL=http://54.250.190.42:3000

export function tpGatewayUrl(): string {
  const url = process.env.TP_GATEWAY_URL;
  if (!url) {
    throw new Error(
      "TP_GATEWAY_URL is not set. Set it (Vercel env / web/.env) to the TP gateway base URL, e.g. http://<ec2-ip>:3000",
    );
  }
  return url.replace(/\/$/, "");
}
