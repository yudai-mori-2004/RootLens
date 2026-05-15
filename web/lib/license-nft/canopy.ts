// SPDX-License-Identifier: Apache-2.0
//
// Bubblegum / spl-account-compression / mpl-account-compression が共有する
// concurrent merkle tree の canopy 関連ヘルパー。 Solana SDK 非依存の pure module
// (= Node の Buffer + Math のみ)、 unit test で容易に検証できる。

/**
 * concurrent merkle tree account の生バイト列から canopy_depth を逆算する。
 *
 * tree account の layout:
 *   header (56B):
 *     account_type    u8
 *     header_variant  u8
 *     max_buffer_size u32 LE   (offset  2)
 *     max_depth       u32 LE   (offset  6)
 *     authority       Pubkey   (offset 10, 32B)
 *     creation_slot   u64 LE   (offset 42)
 *     _padding        [u8; 6]  (offset 50)
 *
 *   body: ConcurrentMerkleTree<MAX_DEPTH, MAX_BUFFER_SIZE>
 *     sequence_number u64
 *     active_index    u64
 *     buffer_size     u64
 *     change_logs     [ChangeLog<MAX_DEPTH>; MAX_BUFFER_SIZE]
 *     rightmost_proof Path<MAX_DEPTH>
 *
 *   canopy: ((1 << (canopy_depth+1)) - 2) * 32 bytes
 *
 * canopy_depth は account 作成時に決まり、 ヘッダには記録されない。 全体サイズから
 * body サイズを引いた残り (canopy 領域) のバイト数から逆算する。
 *
 * canopy なし (= fixture や古いツリー) のときは 0 を返す。 ヘッダ不正 / 想定外
 * サイズの場合も 0 を返して、 呼び出し側は full proof のまま動く。
 */
export function inferCanopyDepth(treeAccountData: Buffer | Uint8Array): number {
  const buf = Buffer.isBuffer(treeAccountData) ? treeAccountData : Buffer.from(treeAccountData);
  const HEADER_SIZE = 56;
  if (buf.length < HEADER_SIZE) return 0;

  const maxBufferSize = buf.readUInt32LE(2);
  const maxDepth = buf.readUInt32LE(6);
  if (maxDepth === 0 || maxBufferSize === 0) return 0;

  const changeLogSize = 32 + 32 * maxDepth + 4 + 4;        // ChangeLog<D>
  const pathSize = 32 * maxDepth + 32 + 4 + 4;             // Path<D>
  const cmtBody = 24 + changeLogSize * maxBufferSize + pathSize;
  const canopyBytes = buf.length - HEADER_SIZE - cmtBody;

  if (canopyBytes <= 0 || canopyBytes % 32 !== 0) return 0;
  const canopyNodes = canopyBytes / 32;
  // canopy には 2 + 4 + 8 + ... + 2^canopy_depth = 2^(canopy_depth+1) - 2 個の
  // ノードが格納されている。 canopy_nodes + 2 が 2 のべき乗なら有効、 そうで
  // なければ未知の layout として 0 を返す。
  const target = canopyNodes + 2;
  if ((target & (target - 1)) !== 0) return 0;
  return Math.log2(target) - 1;
}

/**
 * canopy_depth を考慮して proof 配列の末尾を切り詰める。
 *
 * Bubblegum / spl-account-compression は canopy の段数 ぶん上層をオンチェーン側に
 * 保管しており、 client は残り `depth - canopy_depth` 段ぶんの sibling のみ tx に
 * 詰めれば済む。 canopy=0 のツリーでは何も切らず元の proof をそのまま返す。
 *
 * pure 関数。 入力配列は変更しない。
 */
export function truncateProofForCanopy<T>(proof: ReadonlyArray<T>, canopyDepth: number): T[] {
  if (canopyDepth <= 0) return proof.slice();
  const keep = Math.max(0, proof.length - canopyDepth);
  return proof.slice(0, keep);
}

