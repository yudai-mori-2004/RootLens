/**
 * 仕様書 §4.4 証明書発行フロー + §4.4.2 証明書更新
 *
 * iOS でのアプリ起動時に:
 *   1. Device Certificate が存在するか確認
 *   2. 未取得 → TEE 鍵生成 (Secure Enclave) → CSR + App Attest → サーバ発行 → 保存
 *   3. 取得済 → 有効期限確認 → 残 14 日以内ならバックグラウンド更新
 *   4. ICA ローテーション検出時は再プロビジョニング
 *
 * 依存:
 *   - native: app/modules/c2pa-bridge/ios/C2paBridgeModule.swift (TEE keygen / CSR / App Attest / cert chain)
 *   - server: web/app/api/v1/device-certificate{,/renew}/route.ts
 */

import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
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
  | 'provisioning'  // 証明書取得中（初回、UI ブロック想定）
  | 'ready'         // 証明書あり、利用可能
  | 'renewing'      // バックグラウンド更新中（UI ブロックしない）
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

/** サーバに証明書を要求する共通処理 (provision / renew どちらも同じ shape) */
async function requestCertificate(
  url: string,
): Promise<{
  device_certificate: string;
  intermediate_ca_certificate: string;
  root_ca_certificate: string;
  device_id: string;
}> {
  // §4.4.1: TEE 鍵生成 + CSR + App Attest
  const credentials = await generateDeviceCredentials();

  // §4.4.1: サーバに送信。attestation は credentials 由来 (iOS は app_attest_object/key_id)
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
 * 証明書プロビジョニングフック (iOS 限定)
 *
 * 初回は provisioning 状態で UI ブロックし、取得後 ready へ遷移。
 * 更新は renewing 状態だが UI ブロックしない (既存の cert で署名は継続可能)。
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

      // §4.4.1 ステップ 7: cert chain (Device + Intermediate + Root) を保存
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
        // DEV ビルドでは continue (legacy PEM 署名でも撮影できる #if DEBUG path)
        console.warn('[CertProvisioning] DEV mode: continuing without certificate');
        safeSetState({ status: 'ready', error: null });
      } else {
        safeSetState({ status: 'error', error: msg });
      }
    } finally {
      provisioningRef.current = false;
    }
  };

  /** 証明書の更新 (background、UI ブロックしない) */
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
      // 更新失敗は致命的ではない — 既存 cert が有効な間は署名可能
      console.warn('[CertProvisioning] Renewal failed (non-fatal):', e);
      safeSetState({ status: 'ready', error: null });
    }
  };

  /** 状態を確認し、必要に応じてプロビジョニング/更新 */
  const checkAndProvision = async () => {
    try {
      const hasCert = await hasDeviceCertificate();

      if (!hasCert) {
        await provision();
        return;
      }

      // PKI ローテ検出: Device cert が現 ICA で署名されているか
      // ICA 鍵が変わった (Root CA 再生成 / ICA 再発行) 場合に自動再プロビジョニング
      const chainValid = await verifyStoredCertChain();
      if (!chainValid) {
        console.warn('[CertProvisioning] Chain integrity check failed — ICA rotation detected, re-provisioning');
        await clearStoredCertificates();
        await provision();
        return;
      }

      // 残期間で background renew 判定
      const expiry = await getDeviceCertificateExpiry();
      if (expiry) {
        const remaining = daysUntilExpiry(expiry);
        console.log(`[CertProvisioning] Certificate expires in ${remaining} days`);

        if (remaining <= config.certRenewalThresholdDays) {
          // §4.4.2: 残 14 日以内 → background renew (ready のまま非同期で更新)
          safeSetState({ status: 'ready', error: null });
          renew();
          return;
        }
      }

      safeSetState({ status: 'ready', error: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[CertProvisioning] Check failed:', msg);
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

    // foreground 復帰時にも更新チェック (ready のときだけ、provisioning 中は無視)
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && state.status === 'ready') {
        checkAndProvision();
      }
    });

    return () => {
      mountedRef.current = false;
      subscription.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = () => {
    if (state.status === 'error') {
      checkAndProvision();
    }
  };

  return { ...state, retry };
}
