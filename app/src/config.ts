// rootlens-server エンドポイントの構築。 base URL は src/env.ts で env 経由に統一。

import { SERVER_URL } from './env';

export const config = {
  serverUrl: SERVER_URL,
  /** C2PA 署名用 Device Certificate 発行 (= 起動時プロビジョニング) */
  deviceCertificateUrl: `${SERVER_URL}/api/v1/device-certificate`,
  /** C2PA 署名用 Device Certificate 更新 */
  deviceCertificateRenewUrl: `${SERVER_URL}/api/v1/device-certificate/renew`,
  /** 証明書更新しきい値 (日) */
  certRenewalThresholdDays: 14,
};
