/**
 * IPベースのレート制限
 * 仕様書 §4.4.3: 証明書発行APIのレートリミット
 *
 * インメモリ実装（単一サーバーインスタンス想定）。
 * Vercelなど複数インスタンス環境では Upstash Redis 等に置き換える。
 */

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------

export interface RateLimitConfig {
  /** 許容リクエスト数 */
  limit: number;
  /** ウィンドウ期間（ミリ秒） */
  windowMs: number;
}

/** デフォルトプリセット */
export const RATE_LIMITS = {
  /** 証明書初回発行: 10 req / hour / IP */
  certIssue: { limit: 10, windowMs: 60 * 60 * 1000 } satisfies RateLimitConfig,
  /** 証明書更新: 5 req / hour / IP */
  certRenew: { limit: 5, windowMs: 60 * 60 * 1000 } satisfies RateLimitConfig,
  /** CRL取得: 60 req / min / IP */
  crl: { limit: 60, windowMs: 60 * 1000 } satisfies RateLimitConfig,
} as const;

// ---------------------------------------------------------------------------
// インメモリストア
// ---------------------------------------------------------------------------

interface WindowEntry {
  count: number;
  resetAt: number; // Unix ms
}

// key → WindowEntry
const store = new Map<string, WindowEntry>();

// 古いエントリの掃除（メモリリーク防止）
let lastCleanup = Date.now();
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5分

function cleanup(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// チェック関数
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // Unix ms
}

/**
 * レート制限を確認する。
 *
 * @param key 識別キー（通常は "endpoint:ip"）
 * @param config 制限設定
 * @returns 許可/拒否 + 残りリクエスト数
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  cleanup();

  const now = Date.now();
  let entry = store.get(key);

  // ウィンドウ期限切れまたは初回 → リセット
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + config.windowMs };
    store.set(key, entry);
  }

  entry.count++;

  if (entry.count > config.limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
    };
  }

  return {
    allowed: true,
    remaining: config.limit - entry.count,
    resetAt: entry.resetAt,
  };
}

/**
 * IPアドレスを抽出する。
 * Next.js の場合は x-forwarded-for ヘッダーから取得。
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}

/** テスト用: ストアをリセット */
export function _resetStore(): void {
  store.clear();
}
