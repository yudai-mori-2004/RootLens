// Upload one complete Mentra capture to the raw R2 contract and verify every object.
// Usage: node scripts/r2_mentra_upload.mjs <clip-directory> <content-hash>
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(webRoot, ".env.local"), quiet: true });
config({ path: join(webRoot, ".env"), quiet: true });

const [, , clipDirectoryArg, contentHashArg] = process.argv;
const contentHash = contentHashArg?.toLowerCase();

if (!clipDirectoryArg || !/^[0-9a-f]{64}$/.test(contentHash ?? "")) {
  console.error("usage: node scripts/r2_mentra_upload.mjs <clip-directory> <64-char-content-hash>");
  process.exit(2);
}

const requiredEnvironment = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
for (const name of requiredEnvironment) {
  if (!process.env[name]) throw new Error(`missing required environment variable: ${name}`);
}

const bucket = process.env.R2_BUCKET_RAW_MENTRA ?? "rootlens-raw-mentra";
const endpoint = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const clipDirectory = resolve(clipDirectoryArg);
const uploadFiles = [
  ["frames.jsonl", "application/x-ndjson"],
  ["imu.jsonl", "application/x-ndjson"],
  ["rgb.mp4", "video/mp4"],
  ["metadata.json", "application/json"],
];

for (const [name] of uploadFiles) {
  const path = join(clipDirectory, name);
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`missing capture file: ${path}`);
}

const sha256File = async (path) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
};

const actualVideoHash = await sha256File(join(clipDirectory, "rgb.mp4"));
if (actualVideoHash !== contentHash) {
  throw new Error(`rgb.mp4 SHA-256 mismatch: expected ${contentHash}, got ${actualVideoHash}`);
}
console.log(`validated rgb.mp4 SHA-256: ${contentHash}`);

const r2 = new S3Client({
  region: "auto",
  endpoint,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const awsEnvironment = {
  ...process.env,
  AWS_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  AWS_DEFAULT_REGION: "auto",
  AWS_REGION: "auto",
};

for (const [name, contentType] of uploadFiles) {
  const localPath = join(clipDirectory, name);
  const key = `raw/${contentHash}/${name}`;
  const size = statSync(localPath).size;
  console.log(`uploading ${name} (${size} bytes) -> s3://${bucket}/${key}`);

  const result = spawnSync(
    "aws",
    [
      "s3",
      "cp",
      localPath,
      `s3://${bucket}/${key}`,
      "--endpoint-url",
      endpoint,
      "--content-type",
      contentType,
      "--only-show-errors",
      "--no-progress",
    ],
    { env: awsEnvironment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit status ${result.status}`;
    throw new Error(`upload failed for ${name}: ${detail}`);
  }

  const head = await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  if (head.ContentLength !== size) {
    throw new Error(`R2 size mismatch for ${name}: local=${size}, remote=${head.ContentLength}`);
  }
  if (head.ContentType !== contentType) {
    throw new Error(`R2 content type mismatch for ${name}: expected=${contentType}, remote=${head.ContentType}`);
  }
  console.log(`verified ${name}: ${head.ContentLength} bytes, ${head.ContentType}`);
}

console.log(`upload complete: s3://${bucket}/raw/${contentHash}/`);
