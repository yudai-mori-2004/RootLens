// SPDX-License-Identifier: Apache-2.0
//
// canopy.ts (concurrent merkle tree の canopy_depth 推定 + proof 切り詰め) の
// 単体テスト。 inferCanopyDepth は spl-account-compression /
// mpl-account-compression のレイアウトに密結合な parser のため、 ヘッダの
// max_depth / max_buffer_size と canopy ノード数の対応関係を網羅する。 レイアウト
// が将来変わったら早期に気づける構成。
//
// expectedTreeAccountSize は対称関数で round-trip テスト用。

import { describe, expect, it } from "vitest";
import {
  expectedTreeAccountSize,
  inferCanopyDepth,
  truncateProofForCanopy,
} from "../canopy";

function buildTreeAccount(maxDepth: number, maxBufferSize: number, canopyDepth: number): Buffer {
  const size = expectedTreeAccountSize(maxDepth, maxBufferSize, canopyDepth);
  const buf = Buffer.alloc(size);
  buf.writeUInt8(1, 0);                    // account_type
  buf.writeUInt8(0, 1);                    // header_variant
  buf.writeUInt32LE(maxBufferSize, 2);
  buf.writeUInt32LE(maxDepth, 6);
  // authority(32) + creation_slot(8) + padding(6) + body は 0 埋めで OK
  return buf;
}

describe("inferCanopyDepth", () => {
  // 実 chain で確認した代表的な組み合わせ
  const cases: Array<{ depth: number; buffer: number; canopy: number }> = [
    { depth: 5, buffer: 8, canopy: 0 },     // existing setup.ts (fixture, depth=5)
    { depth: 14, buffer: 64, canopy: 10 },  // setup-canopy-root-tree.ts
    { depth: 14, buffer: 64, canopy: 11 },  // alt canopy
    { depth: 20, buffer: 64, canopy: 14 },  // bubblegum max
    { depth: 14, buffer: 64, canopy: 0 },   // depth 14 だが canopy なし (= 旧 TP tree 想定)
  ];

  for (const c of cases) {
    it(`recovers canopy=${c.canopy} for depth=${c.depth} buffer=${c.buffer}`, () => {
      const buf = buildTreeAccount(c.depth, c.buffer, c.canopy);
      expect(inferCanopyDepth(buf)).toBe(c.canopy);
    });
  }

  it("returns 0 when buffer is shorter than header", () => {
    expect(inferCanopyDepth(Buffer.alloc(10))).toBe(0);
  });

  it("returns 0 when max_depth is 0 (uninitialized)", () => {
    const buf = Buffer.alloc(56 + 1024);
    buf.writeUInt32LE(64, 2);
    buf.writeUInt32LE(0, 6);
    expect(inferCanopyDepth(buf)).toBe(0);
  });

  it("returns 0 when canopy bytes are not a multiple of 32 (corrupted account)", () => {
    const valid = buildTreeAccount(14, 64, 10);
    const broken = Buffer.concat([valid, Buffer.from([0xff])]);
    expect(inferCanopyDepth(broken)).toBe(0);
  });

  it("returns 0 when canopy_node_count + 2 is not a power of two (unknown layout)", () => {
    const valid = buildTreeAccount(5, 8, 0);
    // 5 ノード ぶん (= 160 byte) 余分にぶら下げる -> nodes=5, 5+2=7 not pow2
    const broken = Buffer.concat([valid, Buffer.alloc(5 * 32)]);
    expect(inferCanopyDepth(broken)).toBe(0);
  });

  it("accepts Uint8Array input as well as Buffer", () => {
    const buf = buildTreeAccount(14, 64, 10);
    const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    expect(inferCanopyDepth(u8)).toBe(10);
  });
});

describe("truncateProofForCanopy", () => {
  const proof = ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s12", "s13"];

  it("returns the proof unchanged when canopy is 0 (no-op)", () => {
    expect(truncateProofForCanopy(proof, 0)).toEqual(proof);
  });

  it("returns the proof unchanged when canopy is negative (defensive)", () => {
    expect(truncateProofForCanopy(proof, -3)).toEqual(proof);
  });

  it("drops the last canopy_depth siblings when canopy > 0", () => {
    expect(truncateProofForCanopy(proof, 10)).toEqual(["s0", "s1", "s2", "s3"]);
    expect(truncateProofForCanopy(proof, 4)).toEqual(["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"]);
  });

  it("returns an empty array when canopy_depth >= proof.length", () => {
    expect(truncateProofForCanopy(proof, proof.length)).toEqual([]);
    expect(truncateProofForCanopy(proof, proof.length + 5)).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const original = proof.slice();
    truncateProofForCanopy(proof, 10);
    expect(proof).toEqual(original);
  });

  it("returns a new array (not a reference to the input) even for canopy=0", () => {
    const result = truncateProofForCanopy(proof, 0);
    expect(result).not.toBe(proof);
    expect(result).toEqual(proof);
  });
});

describe("expectedTreeAccountSize (round-trip with inferCanopyDepth)", () => {
  for (const depth of [5, 10, 14, 20]) {
    for (const canopy of [0, 1, 5, 10, depth]) {
      if (canopy > depth) continue;
      it(`round-trips depth=${depth} canopy=${canopy}`, () => {
        const buf = buildTreeAccount(depth, 64, canopy);
        expect(buf.length).toBe(expectedTreeAccountSize(depth, 64, canopy));
        expect(inferCanopyDepth(buf)).toBe(canopy);
      });
    }
  }
});
