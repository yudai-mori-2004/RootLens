// R2 の prefix を一覧する / オブジェクトをローカルに落とす検証ユーティリティ。
//   list:  node scripts/r2_inspect.mjs list <raw|arkit|mentra|processed> <prefix>
//   get:   node scripts/r2_inspect.mjs get  <raw|arkit|mentra|processed> <key> <localPath>
import { config } from "dotenv";
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(root, ".env.local") });
config({ path: join(root, ".env") });

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const bucketOf = (name) => {
  if (name === "raw") return process.env.R2_BUCKET_RAW;
  if (name === "arkit") return process.env.R2_BUCKET_RAW_ARKIT ?? "rootlens-raw-arkit";
  if (name === "mentra") return process.env.R2_BUCKET_RAW_MENTRA ?? "rootlens-raw-mentra";
  if (name === "iphone") return process.env.R2_BUCKET_RAW;
  if (name === "processed") return process.env.R2_BUCKET_PROCESSED;
  throw new Error(`unknown bucket alias: ${name}`);
};

const [, , cmd, bucketName, a, b] = process.argv;
const Bucket = bucketOf(bucketName);

if (cmd === "list") {
  const res = await r2.send(new ListObjectsV2Command({ Bucket, Prefix: a }));
  const items = (res.Contents ?? []).map((o) => ({ key: o.Key, size: o.Size }));
  console.log(`bucket=${Bucket} prefix=${a} → ${items.length} object(s)`);
  for (const it of items) console.log(`  ${it.size.toString().padStart(10)}  ${it.key}`);
} else if (cmd === "get") {
  const res = await r2.send(new GetObjectCommand({ Bucket, Key: a }));
  const buf = Buffer.from(await res.Body.transformToByteArray());
  writeFileSync(b, buf);
  console.log(`wrote ${buf.length} bytes → ${b}`);
} else {
  console.error("usage: list <raw|arkit|mentra|iphone|processed> <prefix>  |  get <raw|arkit|mentra|iphone|processed> <key> <localPath>");
  process.exit(1);
}
