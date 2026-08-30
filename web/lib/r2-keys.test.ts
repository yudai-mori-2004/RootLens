import { describe, expect, it } from "vitest";

import { RAW_SESSION_MANIFEST, rawSessionFileKey } from "./r2-keys";

describe("Mentra raw upload contract", () => {
  it("presigns every file required by the device uploader", () => {
    expect(RAW_SESSION_MANIFEST.mentra).toEqual([
      { filename: "rgb.mp4", contentType: "video/mp4" },
      { filename: "frames.jsonl", contentType: "application/x-ndjson" },
      { filename: "imu.jsonl", contentType: "application/x-ndjson" },
      { filename: "metadata.json", contentType: "application/json" },
    ]);
  });

  it("uses the content-addressed raw prefix", () => {
    const hash = "a".repeat(64);
    expect(rawSessionFileKey(hash, "frames.jsonl")).toBe(
      `raw/${hash}/frames.jsonl`,
    );
  });
});

describe("iPhone RGB+IMU raw upload contract", () => {
  it("matches the Mentra delivered manifest exactly", () => {
    expect(RAW_SESSION_MANIFEST.iphone).toEqual(RAW_SESSION_MANIFEST.mentra);
  });
});

describe("ARKit raw upload contract", () => {
  it("presigns the complete current iPhone delivery manifest", () => {
    expect(RAW_SESSION_MANIFEST.arkit).toEqual([
      { filename: "rgb.mp4", contentType: "video/mp4" },
      { filename: "frames.jsonl", contentType: "application/x-ndjson" },
      { filename: "realtime_handpose.jsonl", contentType: "application/x-ndjson" },
      { filename: "imu.jsonl", contentType: "application/x-ndjson" },
      { filename: "metadata.json", contentType: "application/json" },
      { filename: "depth.tar", contentType: "application/x-tar" },
      { filename: "pointcloud.jsonl", contentType: "application/x-ndjson" },
      { filename: "mesh.jsonl", contentType: "application/x-ndjson" },
      { filename: "arkit_imu.jsonl", contentType: "application/x-ndjson" },
      { filename: "device_metrics.jsonl", contentType: "application/x-ndjson" },
    ]);
  });
});
