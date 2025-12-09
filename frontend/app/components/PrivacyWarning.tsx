import { C2PASummaryData } from '@/app/lib/c2pa-parser';

interface PrivacyWarningProps {
  c2paSummary: C2PASummaryData;
  onAcknowledge: (acknowledged: boolean) => void;
  acknowledged: boolean;
}

export default function PrivacyWarning({
  c2paSummary,
  onAcknowledge,
  acknowledged,
}: PrivacyWarningProps) {
  const activeManifest = c2paSummary.activeManifest;

  if (!activeManifest) {
    return null;
  }

  // C2PAメタデータから公開される可能性のある情報を抽出
  const publicInfo: { label: string; value: string; icon: string }[] = [];

  // 署名情報
  if (activeManifest.signatureInfo.issuer) {
    publicInfo.push({
      label: '署名者',
      value: activeManifest.signatureInfo.issuer,
      icon: '🔒',
    });
  }

  if (activeManifest.signatureInfo.time) {
    publicInfo.push({
      label: '署名日時',
      value: new Date(activeManifest.signatureInfo.time).toLocaleString('ja-JP'),
      icon: '📅',
    });
  }

  // クレームジェネレーター（カメラ/ソフトウェア）
  if (activeManifest.claimGenerator.name) {
    publicInfo.push({
      label: '生成元',
      value: `${activeManifest.claimGenerator.name}${
        activeManifest.claimGenerator.version ? ` v${activeManifest.claimGenerator.version}` : ''
      }`,
      icon: '📷',
    });
  }

  // プロデューサー
  if (activeManifest.producer?.name) {
    publicInfo.push({
      label: 'プロデューサー',
      value: activeManifest.producer.name,
      icon: '👤',
    });
  }

  // アクション情報
  if (activeManifest.assertions.actions.length > 0) {
    activeManifest.assertions.actions.forEach((action, index) => {
      if (action.when) {
        publicInfo.push({
          label: `編集日時 ${index + 1}`,
          value: new Date(action.when).toLocaleString('ja-JP'),
          icon: '✏️',
        });
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* 警告メッセージ */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl">⚠️</span>
          <div>
            <h4 className="font-bold text-yellow-800 mb-1">プライバシー情報の公開について</h4>
            <p className="text-sm text-yellow-700">
              このメディアにはC2PA署名が含まれており、以下の情報が公開されます。
              <br />
              GPS位置情報、シリアル番号などの個人情報が含まれる場合があります。
            </p>
          </div>
        </div>
      </div>

      {/* 公開される情報の一覧 */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h5 className="font-bold text-gray-900 mb-3">公開される情報</h5>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {publicInfo.map((info, index) => (
            <div key={index} className="flex items-start gap-2 text-sm">
              <span className="text-lg">{info.icon}</span>
              <div>
                <p className="text-gray-500 text-xs">{info.label}</p>
                <p className="text-gray-900 font-medium break-all">{info.value}</p>
              </div>
            </div>
          ))}
        </div>

        {publicInfo.length === 0 && (
          <p className="text-sm text-gray-500">公開される情報はありません</p>
        )}
      </div>

      {/* 詳細情報の注意 */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <span className="text-xl">💡</span>
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">その他の情報</p>
            <p>
              上記以外にも、EXIF情報（GPS位置、カメラ設定、レンズ情報等）や、
              編集履歴の詳細が含まれる可能性があります。
              アップロード前に、メタデータを確認してください。
            </p>
          </div>
        </div>
      </div>

      {/* 同意チェックボックス */}
      <div className="border-t pt-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => onAcknowledge(e.target.checked)}
            className="mt-1 w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-700">
            上記の情報が公開されることを理解し、同意します。
            <br />
            <span className="text-xs text-gray-500">
              （この情報はブロックチェーン上に永久に記録され、削除できません）
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}
