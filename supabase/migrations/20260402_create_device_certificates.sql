-- Task 24 Phase 1: デバイス証明書発行ログテーブル
-- 仕様書 §4.7 鍵ライフサイクル管理
--
-- CRL運用の前提条件: シリアル番号管理による失効対象の特定
-- 監査ログ: いつ・どのデバイス・どのプラットフォームに発行したかの記録

CREATE TABLE device_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_number TEXT NOT NULL UNIQUE,
  device_id_hash TEXT NOT NULL,          -- SHA-256(pubkey DER)[:16]
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  attestation_level TEXT,                -- 'strongbox', 'tee', 'secure_enclave', null(dev)
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_device_certificates_device_id ON device_certificates(device_id_hash);
CREATE INDEX idx_device_certificates_serial ON device_certificates(serial_number);
CREATE INDEX idx_device_certificates_revoked ON device_certificates(revoked_at)
  WHERE revoked_at IS NOT NULL;

-- RLS: service_role のみ読み書き可能（クライアントからは直接アクセスしない）
ALTER TABLE device_certificates ENABLE ROW LEVEL SECURITY;

CREATE POLICY device_certificates_service_only ON device_certificates
  FOR ALL
  USING (false)
  WITH CHECK (false);
-- service_role は RLS をバイパスするため、この DENY-ALL ポリシーは anon/authenticated のみに適用
