// rootlens-server エンドポイントの構築。 base URL は src/env.ts で env 経由に統一。

import { SERVER_URL } from './env';

export const config = {
  serverUrl: SERVER_URL,
};
