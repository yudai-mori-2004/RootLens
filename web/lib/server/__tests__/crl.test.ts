/**
 * CRL（証明書失効リスト）のテスト
 */

import { describe, it, expect, beforeEach } from "vitest";
import { revokeCertificate, isRevoked, getRevokedSerials } from "../crl";

// Note: crl.tsはモジュールレベルのSetを使うため、テスト間で状態が共有される。
// 現在のインメモリ実装では完全なリセットが不可能。
// Supabase移行後はテストごとにDBをリセットできるようになる。

describe("CRL", () => {
  it("証明書を失効させて確認できる", () => {
    const serial = "test_" + Date.now().toString(16);
    expect(isRevoked(serial)).toBe(false);

    revokeCertificate(serial);
    expect(isRevoked(serial)).toBe(true);
  });

  it("大文字小文字を正規化する", () => {
    const serial = "AABBCC_" + Date.now().toString(16);
    revokeCertificate(serial);

    expect(isRevoked(serial.toLowerCase())).toBe(true);
    expect(isRevoked(serial.toUpperCase())).toBe(true);
  });

  it("失効リストを取得できる", () => {
    const serial = "list_test_" + Date.now().toString(16);
    revokeCertificate(serial);

    const serials = getRevokedSerials();
    expect(serials).toContain(serial.toLowerCase());
  });

  it("未失効の証明書はfalse", () => {
    expect(isRevoked("definitely_not_revoked_" + Date.now())).toBe(false);
  });

  it("同じシリアルの二重失効はエラーにならない", () => {
    const serial = "double_" + Date.now().toString(16);
    revokeCertificate(serial);
    revokeCertificate(serial); // 二重呼び出し
    expect(isRevoked(serial)).toBe(true);
  });
});
