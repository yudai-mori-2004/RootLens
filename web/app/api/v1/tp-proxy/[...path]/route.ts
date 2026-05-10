/**
 * Title Protocol gateway HTTPS proxy.
 *
 * 目的: iOS app から plain HTTP の TP gateway (http://54.250.143.52:3000) に
 * fetch しようとすると "Network request failed" になる (ATS=arbitrary loads でも
 * iOS 26.x で IP literal + plain HTTP の組合せが block される)。
 *
 * このルート経由で HTTPS 越しに TP gateway へ転送する。proxy 通るのは小さな
 * JSON (upload-url, verify, sign-and-mint) のみ。動画 blob 本体は presigned URL
 * で AWS S3 に直接 PUT するので proxy しない。
 *
 * 例:
 *   POST https://www.rootlens.io/api/v1/tp-proxy/upload-url
 *     ↓ 転送
 *   POST http://54.250.143.52:3000/upload-url
 *
 * 危険: open relay にしないため、転送先は ALLOWED_GATEWAYS の whitelist のみ。
 * 単一 gateway 想定なので env override も用意するが default 1 件。
 */

import { NextRequest, NextResponse } from "next/server";

const ALLOWED_GATEWAYS = (
  process.env.TP_GATEWAY_PROXY_TARGETS ??
  "http://54.250.143.52:3000"
).split(",").map((u) => u.trim().replace(/\/$/, ""));

const ALLOWED_PATHS = new Set([
  "upload-url",
  "verify",
  "sign",
  "sign-and-mint",
  "health",
]);

export const runtime = "nodejs";

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (!path || path.length === 0) {
    return NextResponse.json({ error: "missing path" }, { status: 400 });
  }
  const subpath = path.join("/");
  if (!ALLOWED_PATHS.has(path[0])) {
    return NextResponse.json(
      { error: `path "${subpath}" not in proxy whitelist` },
      { status: 403 },
    );
  }

  // gateway は env か固定 default。ALLOWED_GATEWAYS[0] を使う。
  // 複数 gateway を切替えたい場合は header X-TP-Gateway で whitelist 内から選択可能。
  const headerGw = req.headers.get("x-tp-gateway")?.trim().replace(/\/$/, "");
  const gateway = headerGw && ALLOWED_GATEWAYS.includes(headerGw)
    ? headerGw
    : ALLOWED_GATEWAYS[0];
  if (!gateway) {
    return NextResponse.json({ error: "no gateway configured" }, { status: 500 });
  }

  const target = `${gateway}/${subpath}`;
  const method = req.method;
  const isJson = method === "POST" || method === "PUT" || method === "PATCH";
  let body: string | undefined;
  if (isJson) {
    try { body = await req.text(); } catch { body = undefined; }
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers: { "Content-Type": "application/json" },
      body,
      // 30s upper bound — TP gateway は通常 1-3s で返るが verify は重い場合あり
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: `gateway fetch failed: ${e?.message ?? e}`, target },
      { status: 502 },
    );
  }

  // body をそのまま透過 (TP gateway は JSON を返す)
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

export const POST = handle;
export const GET = handle;
