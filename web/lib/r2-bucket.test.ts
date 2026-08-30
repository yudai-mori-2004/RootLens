import { expect, it } from "vitest";

it("routes iPhone RGB+IMU to the existing raw bucket", async () => {
  process.env.R2_ACCOUNT_ID = "test-account";
  process.env.R2_ACCESS_KEY_ID = "test-access-key";
  process.env.R2_SECRET_ACCESS_KEY = "test-secret-key";
  process.env.R2_BUCKET_RAW = "raw-test";
  process.env.R2_BUCKET_RAW_ARKIT = "arkit-test";
  process.env.R2_BUCKET_RAW_MENTRA = "mentra-test";
  process.env.R2_BUCKET_RAW_IPHONE = "must-be-ignored";

  const { rawBucketFor } = await import("./r2");

  expect(rawBucketFor("ultra_wide")).toBe("raw-test");
  expect(rawBucketFor("arkit")).toBe("arkit-test");
  expect(rawBucketFor("mentra")).toBe("mentra-test");
  expect(rawBucketFor("iphone")).toBe("raw-test");
});
