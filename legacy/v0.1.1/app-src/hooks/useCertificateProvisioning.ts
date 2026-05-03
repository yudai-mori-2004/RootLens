/**
 * 仕様書 §4.4 証明書発行フロー + §4.4.2 証明書更新
 *
 * アプリ起動時に:
 * 1. Device Certificateが存在するか確認
 * 2. 未取得 → TEE鍵生成 → CSR → サーバーに送信 → 証明書保存
 * 3. 取得済み → 有効期限確認 → 14日以内ならバックグラウンド更新
 */

import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import {
  generateDeviceCredentials,
  storeDeviceCertificate,
  hasDeviceCertificate,
  getDeviceCertificateExpiry,
  verifyStoredCertChain,
  clearStoredCertificates,
} from '../native/c2paBridge';
import { config } from '../config';

export type CertStatus =
  | 'checking'      // 初期確認中
  | 'provisioning'  // 証明書取得中（初回）
  | 'ready'         // 証明書あり、利用可能
  | 'renewing'      // バックグラウンド更新中（UIブロックしない）
  | 'error';        // エラー（リトライ可能）

interface CertState {
  status: CertStatus;
  error: string | null;
}

/** 証明書が残り何日で期限切れかを計算 */
function daysUntilExpiry(expiryIso: string): number {
  const expiry = new Date(expiryIso).getTime();
  const now = Date.now();
  return Math.floor((expiry - now) / (1000 * 60 * 60 * 24));
}

/** サーバーに証明書を要求する共通処理 */
async function requestCertificate(
  url: string,
): Promise<{ device_certificate: string; intermediate_ca_certificate: string; root_ca_certificate: string; device_id: string }> {
  // §4.4.1: TEE鍵生成 + CSR作成
  const credentials = await generateDeviceCredentials();

  // §4.4.1: サーバーに送信（attestationがあれば含める）
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: credentials.platform,
      csr: credentials.csr,
      attestation: credentials.attestation,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Certificate request failed (${response.status}): ${body}`);
  }

  return response.json();
}

/**
 * 証明書プロビジョニングフック
 *
 * 初回起動時は provisioning 状態でUIをブロックし、証明書取得後に ready へ遷移。
 * 更新時は renewing 状態だがUIはブロックしない（既存の証明書で署名可能）。
 */
export function useCertificateProvisioning(): CertState & { retry: () => void } {
  const [state, setState] = useState<CertState>({
    status: 'checking',
    error: null,
  });
  const mountedRef = useRef(true);
  const provisioningRef = useRef(false);

  const safeSetState = (newState: CertState) => {
    if (mountedRef.current) setState(newState);
  };

  /** 証明書の初回取得 */
  const provision = async () => {
    if (provisioningRef.current) return;
    provisioningRef.current = true;

    safeSetState({ status: 'provisioning', error: null });

    try {
      const result = await requestCertificate(config.deviceCertificateUrl);

      // §4.4.1 ステップ7: 証明書保存（Device + Intermediate CA + Root CA）
      await storeDeviceCertificate(
        result.device_certificate,
        result.intermediate_ca_certificate,
        result.root_ca_certificate,
      );

      console.log(`[CertProvisioning] Certificate stored (device_id: ${result.device_id})`);
      safeSetState({ status: 'ready', error: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[CertProvisioning] Provisioning failed:', msg);
      if (__DEV__) {
        console.warn('[CertProvisioning] DEV mode: continuing without certificate');
        safeSetState({ status: 'ready', error: null });
      } else {
        safeSetState({ status: 'error', error: msg });
      }
    } finally {
      provisioningRef.current = false;
    }
  };

  /** 証明書の更新（バックグラウンド） */
  const renew = async () => {
    safeSetState({ status: 'renewing', error: null });

    try {
      const result = await requestCertificate(config.deviceCertificateRenewUrl);

      await storeDeviceCertificate(
        result.device_certificate,
        result.intermediate_ca_certificate,
        result.root_ca_certificate,
      );

      console.log('[CertProvisioning] Certificate renewed');
      safeSetState({ status: 'ready', error: null });
    } catch (e) {
      // 更新失敗は致命的ではない — 既存の証明書が有効な間は署名可能
      console.warn('[CertProvisioning] Renewal failed (non-fatal):', e);
      safeSetState({ status: 'ready', error: null });
    }
  };

  /** 証明書の状態を確認し、必要に応じてプロビジョニングまたは更新 */
  const checkAndProvision = async () => {
    try {
      const hasCert = await hasDeviceCertificate();

      if (!hasCert) {
        // 初回起動: 証明書を取得
        await provision();
        return;
      }

      // PKIローテーション検出: Device CertがICAで署名されているか検証
      // ICA鍵が変わった場合（Root CA再生成やICA再発行時）に自動で再プロビジョニングする
      const chainValid = await verifyStoredCertChain();
      if (!chainValid) {
        console.warn('[CertProvisioning] Chain integrity check failed — ICA rotation detected, re-provisioning');
        await clearStoredCertificates();
        await provision();
        return;
      }

      // 証明書あり — 有効期限を確認
      const expiry = await getDeviceCertificateExpiry();
      if (expiry) {
        const remaining = daysUntilExpiry(expiry);
        console.log(`[CertProvisioning] Certificate expires in ${remaining} days`);

        if (remaining <= config.certRenewalThresholdDays) {
          // §4.4.2: 残り14日以内 → バックグラウンド更新
          safeSetState({ status: 'ready', error: null });
          // ready にした後、非同期で更新（UIブロックしない）
          renew();
          return;
        }
      }

      safeSetState({ status: 'ready', error: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[CertProvisioning] Check failed:', msg);
      // hasDeviceCertificate自体の失敗はネイティブモジュールの問題
      // DEBUGビルドではready扱いにしてレガシー署名で継続
      if (__DEV__) {
        console.warn('[CertProvisioning] DEV mode: continuing without certificate');
        safeSetState({ status: 'ready', error: null });
      } else {
        safeSetState({ status: 'error', error: msg });
      }
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    checkAndProvision();

    // アプリがフォアグラウンドに戻った時に更新チェック
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && state.status === 'ready') {
        // ready状態の時だけ更新チェック（provisioning中は無視）
        checkAndProvision();
      }
    });

    return () => {
      mountedRef.current = false;
      subscription.remove();
    };
  }, []);

  const retry = () => {
    if (state.status === 'error') {
      checkAndProvision();
    }
  };

  return { ...state, retry };
}
