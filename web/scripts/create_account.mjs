// アカウント発行の運用スクリプト。
//
// Supabase Auth に合成メール (<handle>@rl.local) + パスワードの confirmed ユーザーを作り、
// uuid とログイン QR (PNG) を出力する。 アカウントの意味論 (現場名・契約・振込先) はここでは
// 一切扱わない — 出力された uuid を運営の台帳 (freee 取引先メモ等) に自分で転記すること。
//
// 使い方:
//   node scripts/create_account.mjs            # handle / password 自動生成
//   node scripts/create_account.mjs <handle>   # handle 指定 (英数小文字)
//
// 出力: 標準出力に uuid / handle / password、 ./accounts-out/<handle>.png にログイン QR。
// QR の中身: io.rootlens.app://login?id=<handle>&pw=<password> (= 紙自体が鍵。 保管は台帳と同じ扱いで)

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";
import { mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import QRCode from "qrcode";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
config({ path: join(root, ".env.local") });
config({ path: join(root, ".env") });

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (.env.local / .env)");
  process.exit(1);
}

// 紛らわしい文字 (0/o, 1/l, i) を除いた英数小文字。 手打ちフォールバックに優しい。
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function randomToken(len) {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

const handle = process.argv[2] ?? randomToken(8);
if (!/^[a-z0-9_-]{3,32}$/.test(handle)) {
  console.error(`handle は英数小文字 (+ _ -) 3-32 文字: ${handle}`);
  process.exit(1);
}
const password = randomToken(20);
const email = `${handle}@rl.local`;

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (error) {
  console.error("createUser failed:", error.message);
  process.exit(1);
}

const uuid = data.user.id;
const loginUrl = `io.rootlens.app://login?id=${encodeURIComponent(handle)}&pw=${encodeURIComponent(password)}`;

const outDir = join(root, "accounts-out");
mkdirSync(outDir, { recursive: true });
const qrPath = join(outDir, `${handle}.png`);
await QRCode.toFile(qrPath, loginUrl, { width: 480, margin: 2 });

console.log("アカウントを発行しました。 uuid を台帳 (freee 取引先メモ等) に転記してください。");
console.log("");
console.log(`  uuid     : ${uuid}`);
console.log(`  handle   : ${handle}`);
console.log(`  password : ${password}`);
console.log(`  login QR : ${qrPath}`);
console.log("");
console.log("停止するとき: Supabase ダッシュボード (Auth > Users) で ban するか、 パスワードを変更する。");
