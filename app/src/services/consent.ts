// 同意イベントの記録 (= document/v0.1.3/legal/consent-log-spec/ja.md の実装)。
//
// アップロード同意フォームの「同意して進む」 押下時に、 層化同意の証跡を 1 イベントとして
// サーバ (POST /api/v1/consents、 append-only) に記録する:
//   - 同意対象の正本 (tester-consent) の版 + SHA-256 (= legalDocs.generated が保持)
//   - 画面に表示した層1要約の版 + SHA-256 (= 表示した locale の文言そのものを hash)
//   - スコープ / チェック結果 / locale / 取得方式 / アプリ・端末情報
//
// 記録が成功するまでアップロード画面に進めない (= 証跡なしの同意を作らない)。

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import Constants from 'expo-constants';
import * as Device from 'expo-device';

import { SERVER_URL } from '../env';
import { getCurrentSession } from './auth/instance';
import { getLegalDoc } from '../content/legalDocs.generated';
import { getLocale, t } from '../i18n';

/// 層1要約 (= アップロード同意画面) の版。 文言を変えたら必ず上げる。
export const UPLOAD_CONSENT_SUMMARY_VERSION = 'upload-consent-2026-07-04.2';

/// アップロード同意のスコープ (= tester-consent §4: 収集 / AI学習利用 / 社外ライセンス・販売 / 越境提供)。
const UPLOAD_CONSENT_SCOPES = ['collection', 'ai_training_use', 'license_sale', 'cross_border'] as const;

/// 画面に表示する層1要約を構成する i18n キー (= summaryHash の算出対象。 表示順に固定)。
const SUMMARY_KEYS = [
  'upload.consentTitle',
  'upload.consentIntro',
  'upload.consentBullet1',
  'upload.consentBullet2',
  'upload.consentBullet3',
  'upload.consentCheckAll',
  'upload.consentProceed',
] as const;

/// 1 チェック統合版 (= チェック文言が 18歳以上・第三者なし・正本同意の 3 表明を全部含む)。
export interface UploadConsentChecks {
  combined_consent: boolean;
}

/**
 * アップロード同意イベントをサーバに記録する。 成功で event id を返す。
 * 失敗 (= オフライン等) は throw (= 呼び出し側が表示。 どうせ直後のアップロードもネット必須)。
 */
export async function recordUploadConsent(input: {
  checks: UploadConsentChecks;
  /// 相関情報 (= 対象クリップ)。 個人データは入れない。
  clipLocalId: string;
  clipCreatedAt: number;
  recordingConfig?: string;
}): Promise<string> {
  const session = getCurrentSession();
  if (!session) throw new Error('未認証: session がありません');
  const locale = getLocale();

  // 正本 (層2) の版 + ハッシュ。 raw md の SHA-256 は生成時に確定済み。
  const doc = getLegalDoc(locale, 'tester-consent');
  const docVersion = `draft-${doc.hash.slice(0, 8)}`;

  // 表示した要約 (層1) のハッシュ = 表示 locale の文言を表示順に連結して SHA-256。
  const summaryText = SUMMARY_KEYS.map((k) => t(k)).join('\n');
  const summaryHash = bytesToHex(sha256(new TextEncoder().encode(summaryText)));

  const res = await fetch(`${SERVER_URL}/api/v1/consents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Account-Pubkey': session.pubkey,
    },
    body: JSON.stringify({
      eventType: 'consent',
      occurredAt: new Date().toISOString(),
      docSlug: 'tester-consent',
      docVersion,
      docContentHash: doc.hash,
      summaryVersion: UPLOAD_CONSENT_SUMMARY_VERSION,
      summaryHash,
      scopes: UPLOAD_CONSENT_SCOPES,
      checkboxResults: input.checks,
      locale,
      consentMethod: 'clickwrap',
      appVersion: (Constants.expoConfig?.version as string | undefined) ?? undefined,
      device: Device.modelId ?? undefined,
      context: {
        clipLocalId: input.clipLocalId,
        clipCreatedAt: input.clipCreatedAt,
        ...(input.recordingConfig ? { recordingConfig: input.recordingConfig } : {}),
      },
    }),
  });
  if (res.status !== 201) {
    const text = await res.text().catch(() => '');
    throw new Error(`/api/v1/consents ${res.status}: ${text.slice(0, 200)}`);
  }
  const { id } = (await res.json()) as { id: string };
  return id;
}
