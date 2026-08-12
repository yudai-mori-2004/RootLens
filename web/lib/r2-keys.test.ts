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
