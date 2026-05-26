// rootlens-server エンドポイントの構築。 base URL は src/env.ts で env 経由に統一。

import { SERVER_URL } from './env';

export const config = {
  serverUrl: SERVER_URL,
  /** Pipeline B: presigned URL 発行 */
  uploadUrlEndpoint: `${SERVER_URL}/api/v1/upload-url`,
  /** Pipeline B: ページ作成 */
  publishUrl: `${SERVER_URL}/api/v1/publish`,
  /** Unit H: VLM gate 判定 */
  vlmGateUrl: `${SERVER_URL}/api/v1/vlm-gate`,
  /** Unit E: License Issue API (buyer simulator) */
  licenseIssueUrl: `${SERVER_URL}/api/v1/license/issue`,
  /** Unit A: 証明書発行 */
  deviceCertificateUrl: `${SERVER_URL}/api/v1/device-certificate`,
  /** Unit A: 証明書更新 */
  deviceCertificateRenewUrl: `${SERVER_URL}/api/v1/device-certificate/renew`,
  /** 証明書更新しきい値 (日) */
  certRenewalThresholdDays: 14,
};
