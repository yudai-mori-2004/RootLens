// Delete every Mentra raw object except one complete, explicitly named capture.
// Dry-run is the default. Add --execute only after reviewing the inventory.
import { config } from "dotenv";
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const args = process.argv.slice(2);
const keepIndex = args.indexOf("--keep");
const keepHash = keepIndex >= 0 ? args[keepIndex + 1]?.toLowerCase() : null;
const execute = args.includes("--execute");
if (!keepHash || !/^[0-9a-f]{64}$/.test(keepHash)) {
  throw new Error("usage: node scripts/r2_mentra_prune.mjs --keep <64-char-hash> [--execute]");
}

const requiredEnvironment = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
for (const name of requiredEnvironment) {
  if (!process.env[name]) throw new Error(`missing required environment variable: ${name}`);
}

const bucket = process.env.R2_BUCKET_RAW_MENTRA ?? "rootlens-raw-mentra";
if (bucket !== "rootlens-raw-mentra") {
  throw new Error(`refusing unexpected bucket: ${bucket}`);
}

const client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const contractFiles = new Set(["frames.jsonl", "imu.jsonl", "metadata.json", "rgb.mp4"]);
const contractKey = /^raw\/[0-9a-f]{64}\/(frames\.jsonl|imu\.jsonl|metadata\.json|rgb\.mp4)$/;
const keepPrefix = `raw/${keepHash}/`;

async function listObjects() {
  const objects = [];
  let continuationToken;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: continuationToken,
    }));
    objects.push(...(page.Contents ?? []).map(({ Key, Size }) => ({ key: Key, size: Size ?? 0 })));
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return objects;
}

function validateInventory(objects) {
  if (objects.length === 0) throw new Error("refusing to prune an empty inventory");
  const unexpected = objects.filter(({ key }) => !key || !contractKey.test(key));
  if (unexpected.length > 0) {
    throw new Error(`refusing ${unexpected.length} unexpected key(s): ${unexpected[0].key}`);
  }

  const kept = objects.filter(({ key }) => key.startsWith(keepPrefix));
  const keptNames = new Set(kept.map(({ key }) => key.slice(keepPrefix.length)));
  if (kept.length !== contractFiles.size
      || [...contractFiles].some((name) => !keptNames.has(name))) {
    throw new Error(`keep prefix is incomplete: ${keepPrefix} has ${kept.length} object(s)`);
  }
  return { kept, removed: objects.filter(({ key }) => !key.startsWith(keepPrefix)) };
}

function bytes(objects) {
  return objects.reduce((total, object) => total + object.size, 0);
}

const before = await listObjects();
const inventory = validateInventory(before);
console.log(JSON.stringify({
  mode: execute ? "execute" : "dry-run",
  bucket,
  keepPrefix,
  keepObjects: inventory.kept.length,
  keepBytes: bytes(inventory.kept),
  deleteObjects: inventory.removed.length,
  deleteBytes: bytes(inventory.removed),
}, null, 2));

if (!execute) process.exit(0);

for (let offset = 0; offset < inventory.removed.length; offset += 1000) {
  const batch = inventory.removed.slice(offset, offset + 1000);
  const result = await client.send(new DeleteObjectsCommand({
    Bucket: bucket,
    Delete: {
      Objects: batch.map(({ key }) => ({ Key: key })),
      Quiet: false,
    },
  }));
  if ((result.Errors ?? []).length > 0) {
    const first = result.Errors[0];
    throw new Error(`R2 deletion failed for ${first.Key}: ${first.Code} ${first.Message}`);
  }
}

const after = await listObjects();
const remainingKeys = new Set(after.map(({ key }) => key));
const expectedKeys = new Set(inventory.kept.map(({ key }) => key));
if (remainingKeys.size !== expectedKeys.size
    || [...expectedKeys].some((key) => !remainingKeys.has(key))) {
  throw new Error(`post-delete verification failed: expected ${expectedKeys.size}, got ${remainingKeys.size}`);
}

console.log(JSON.stringify({
  verified: true,
  remainingObjects: after.length,
  remainingBytes: bytes(after),
  keepPrefix,
}, null, 2));
