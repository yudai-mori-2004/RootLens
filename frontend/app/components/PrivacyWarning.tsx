import { C2PASummaryData } from '@/app/lib/c2pa-parser';
import { AlertTriangle, Lock, Calendar, Camera, User, PenTool, Info, Cloud, ChevronDown, FileText, MapPin, Shield, Code, BookOpen, GitBranch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import ProvenanceModal from './ProvenanceModal';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import TechnicalDetailsSection from './TechnicalDetailsSection';

interface PrivacyWarningProps {
  c2paSummary: C2PASummaryData;
  onAcknowledge: (acknowledged: boolean) => void;
  acknowledged: boolean;
  rootSigner?: string;
}

export default function PrivacyWarning({
  c2paSummary,
  onAcknowledge,
  acknowledged,
  rootSigner,
}: PrivacyWarningProps) {
  const [showProvenanceModal, setShowProvenanceModal] = useState(false);
  const [showTechnicalModal, setShowTechnicalModal] = useState(false);
  const [showAllMetadataModal, setShowAllMetadataModal] = useState(false);
  const activeManifest = c2paSummary.activeManifest;

  if (!activeManifest) {
    return null;
  }

  // C2PAメタデータから全ての情報を抽出（来歴モーダルで見られる情報は除外）
  const allMetadata: { label: string; value: string }[] = [];

  // アサーションラベルの日本語説明マッピング
  const assertionDescriptions: Record<string, string> = {
    'c2pa.training-mining': 'AI学習・マイニング制約',
    'cawg.training-mining': 'AI学習・マイニング制約 (CAWG)',
    'c2pa.soft-binding': '透かし情報',
    'cawg.identity': 'デジタル署名情報 (CAWG)',
    'c2pa.hash.data': 'コンテンツハッシュ',
    'c2pa.location': '位置情報',
    'exif': 'Exif情報',
  };

  // ラベルに日本語説明を追加する関数
  const getAssertionLabel = (key: string): string => {
    // __1, __2 などのサフィックスを除去
    const baseKey = key.replace(/__\d+$/, '');
    const description = assertionDescriptions[baseKey];

    if (description) {
      // サフィックスがある場合は番号を追加
      const match = key.match(/__(\d+)$/);
      if (match) {
        return `${description} #${parseInt(match[1]) + 1}`;
      }
      return description;
    }
    return key;
  };

  // バイナリ配列を16進数文字列に変換
  const bytesToHex = (bytes: number[]): string => {
    return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  // オブジェクト内のハッシュ配列を16進数に変換
  const convertHashArraysInObject = (obj: any): any => {
    if (Array.isArray(obj)) {
      // 配列がすべて数値ならハッシュと判定
      if (obj.length > 0 && obj.every((v: any) => typeof v === 'number' && v >= 0 && v <= 255)) {
        return `0x${bytesToHex(obj)}`;
      }
      return obj.map(item => convertHashArraysInObject(item));
    } else if (obj && typeof obj === 'object') {
      const converted: any = {};
      for (const key in obj) {
        // 'hash' というキーの配列を特別扱い
        if (key === 'hash' && Array.isArray(obj[key])) {
          converted[key] = `0x${bytesToHex(obj[key])}`;
        } else {
          converted[key] = convertHashArraysInObject(obj[key]);
        }
      }
      return converted;
    }
    return obj;
  };

  // 基本情報
  if (activeManifest.label) {
    allMetadata.push({ label: 'ラベル', value: activeManifest.label });
  }
  if (activeManifest.title) {
    allMetadata.push({ label: 'タイトル', value: activeManifest.title });
  }
  if (activeManifest.format) {
    allMetadata.push({ label: 'フォーマット', value: activeManifest.format });
  }
  if (activeManifest.vendor) {
    allMetadata.push({ label: 'ベンダー', value: activeManifest.vendor });
  }
  if (activeManifest.instanceId) {
    allMetadata.push({ label: 'インスタンスID', value: activeManifest.instanceId });
  }

  // 署名情報
  if (activeManifest.signatureInfo.issuer) {
    allMetadata.push({ label: '署名者', value: activeManifest.signatureInfo.issuer });
  }
  if (activeManifest.signatureInfo.time) {
    allMetadata.push({
      label: '署名日時',
      value: new Date(activeManifest.signatureInfo.time).toLocaleString('ja-JP'),
    });
  }

  // クレームジェネレーター情報
  if (activeManifest.claimGenerator) {
    allMetadata.push({ label: 'クレームジェネレーター（UserAgent）', value: activeManifest.claimGenerator });
  }
  if (activeManifest.claimGeneratorInfo?.name) {
    allMetadata.push({
      label: '生成元',
      value: `${activeManifest.claimGeneratorInfo.name}${
        activeManifest.claimGeneratorInfo.version ? ` v${activeManifest.claimGeneratorInfo.version}` : ''
      }`,
    });
  }
  if (activeManifest.claimGeneratorHints && Object.keys(activeManifest.claimGeneratorHints).length > 0) {
    allMetadata.push({
      label: 'クレームジェネレーターヒント',
      value: JSON.stringify(activeManifest.claimGeneratorHints, null, 2),
    });
  }

  // プロデューサー
  if (activeManifest.producer?.name) {
    allMetadata.push({ label: 'プロデューサー', value: activeManifest.producer.name });
  }

  // AI生成情報
  if (activeManifest.isAIGenerated) {
    allMetadata.push({ label: 'AI生成', value: 'はい' });
  }

  // 検証可能な証明書
  if (activeManifest.credentials.length > 0) {
    activeManifest.credentials.forEach((credential, index) => {
      if (credential.url) {
        allMetadata.push({ label: `証明書 ${index + 1}: URL`, value: credential.url });
      }
      if (credential.issuer) {
        allMetadata.push({ label: `証明書 ${index + 1}: 発行者`, value: credential.issuer });
      }
      if (credential.type) {
        allMetadata.push({ label: `証明書 ${index + 1}: タイプ`, value: credential.type });
      }
    });
  }

  // 検証済みアイデンティティ
  if (activeManifest.verifiedIdentities.length > 0) {
    activeManifest.verifiedIdentities.forEach((identity, index) => {
      if (identity.name) {
        allMetadata.push({ label: `検証済みID ${index + 1}: 名前`, value: identity.name });
      }
      if (identity.identifier) {
        allMetadata.push({ label: `検証済みID ${index + 1}: 識別子`, value: identity.identifier });
      }
      if (identity.issuer) {
        allMetadata.push({ label: `検証済みID ${index + 1}: 発行者`, value: identity.issuer });
      }
    });
  }

  // CAWG発行者
  if (activeManifest.cawgIssuers.length > 0) {
    allMetadata.push({
      label: 'CAWG発行者',
      value: activeManifest.cawgIssuers.join(', '),
    });
  }

  // 編集・削除情報（Redactions）
  if (activeManifest.redactions.length > 0) {
    allMetadata.push({
      label: '編集・削除されたアサーション',
      value: activeManifest.redactions.join('\n'),
    });
  }

  // 全てのassertion情報を取得
  if (activeManifest.assertions.allAssertions) {
    const allAssertions = activeManifest.assertions.allAssertions;

    // 各assertionをループして表示
    Object.keys(allAssertions).forEach((assertionKey) => {
      const assertionData = allAssertions[assertionKey];

      // すでに表示済みのassertionはスキップ（来歴モーダルで表示される情報）
      if (assertionKey === 'c2pa.actions' || assertionKey === 'c2pa.actions.v2') return;

      // 特別な処理が必要なassertion
      if (assertionKey === 'stds.schema-org.CreativeWork') {
        // Schema.orgのCreativeWorkは構造化データなので特別に処理
        if (assertionData && typeof assertionData === 'object') {
          if (assertionData['@type']) {
            allMetadata.push({ label: 'コンテンツタイプ', value: assertionData['@type'] });
          }

          // 著者情報
          if (assertionData.author && Array.isArray(assertionData.author)) {
            assertionData.author.forEach((author: any, index: number) => {
              if (author['@id']) {
                allMetadata.push({
                  label: `著者 ${index + 1}: プロフィールURL`,
                  value: author['@id'],
                });
              }
              if (author.name) {
                allMetadata.push({
                  label: `著者 ${index + 1}: 名前`,
                  value: author.name,
                });
              }
            });
          }
        }
        return;
      }

      // assertionデータを文字列化して表示
      if (assertionData && typeof assertionData === 'object' && !Array.isArray(assertionData)) {
        // オブジェクトの場合は各フィールドを展開
        Object.keys(assertionData).forEach((key) => {
          const value = assertionData[key];

          if (value === null || value === undefined || value === '') return;

          // バイナリデータ（数値配列）の判定と省略表示
          if (Array.isArray(value) && value.length > 0 && value.every((v: any) => typeof v === 'number')) {
            // バイナリデータは要約表示
            const byteLength = value.length;
            const preview = value.slice(0, 8).join(', ');
            allMetadata.push({
              label: `${getAssertionLabel(assertionKey)} - ${key}`,
              value: `[バイナリデータ: ${byteLength}バイト] (${preview}...)`,
            });
            return;
          }

          // 配列やオブジェクトはJSON文字列化（ハッシュ配列を変換）
          if (typeof value === 'object') {
            const convertedValue = convertHashArraysInObject(value);
            allMetadata.push({
              label: `${getAssertionLabel(assertionKey)} - ${key}`,
              value: JSON.stringify(convertedValue, null, 2),
            });
          } else {
            allMetadata.push({
              label: `${getAssertionLabel(assertionKey)} - ${key}`,
              value: String(value),
            });
          }
        });
      } else if (Array.isArray(assertionData)) {
        // 配列の場合はJSON文字列化
        allMetadata.push({
          label: getAssertionLabel(assertionKey),
          value: JSON.stringify(assertionData, null, 2),
        });
      } else if (assertionData !== null && assertionData !== undefined && assertionData !== '') {
        // プリミティブ値
        allMetadata.push({
          label: getAssertionLabel(assertionKey),
          value: String(assertionData),
        });
      }
    });
  }

  // アクション（編集履歴）と親ファイル情報は来歴モーダルで表示されるため除外

  // 重要情報の抽出
  const importantInfo = {
    title: activeManifest.title,
    signer: activeManifest.signatureInfo.issuer,
    signTime: activeManifest.signatureInfo.time ? new Date(activeManifest.signatureInfo.time).toLocaleString('ja-JP') : null,
    generator: activeManifest.claimGeneratorInfo?.name,
    aiTrainingConstraints: activeManifest.assertions.allAssertions['c2pa.training-mining'] || activeManifest.assertions.allAssertions['cawg.training-mining'],
    watermarks: Object.keys(activeManifest.assertions.allAssertions).filter(k => k.startsWith('c2pa.soft-binding')).length,
    hasExif: !!activeManifest.assertions.allAssertions['exif'],
    hasLocation: !!activeManifest.assertions.allAssertions['c2pa.location'],
  };

  return (
    <div className="space-y-6">
      {/* 簡易表示（重要情報のみ） */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
          <h5 className="font-bold text-gray-900 text-lg">公開される情報</h5>
        </div>

        <div className="p-6 space-y-6">
          {/* 基本情報 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <FileText className="w-4 h-4 text-indigo-500" />
              <span>基本情報</span>
            </div>
            <div className="pl-6 space-y-2 text-sm">
              {importantInfo.title && (
                <div className="flex justify-between py-1.5 border-b border-gray-100">
                  <span className="text-gray-500">タイトル</span>
                  <span className="font-medium text-gray-900">{importantInfo.title}</span>
                </div>
              )}
              {importantInfo.signer && (
                <div className="flex justify-between py-1.5 border-b border-gray-100">
                  <span className="text-gray-500">署名者</span>
                  <span className="font-medium text-gray-900">{importantInfo.signer}</span>
                </div>
              )}
              {importantInfo.signTime && (
                <div className="flex justify-between py-1.5 border-b border-gray-100">
                  <span className="text-gray-500">署名日時</span>
                  <span className="font-medium text-gray-900">{importantInfo.signTime}</span>
                </div>
              )}
              {importantInfo.generator && (
                <div className="flex justify-between py-1.5 border-b border-gray-100">
                  <span className="text-gray-500">生成元</span>
                  <span className="font-medium text-gray-900">{importantInfo.generator}</span>
                </div>
              )}
            </div>
          </div>

          {/* AI学習制約 */}
          {importantInfo.aiTrainingConstraints && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <Shield className="w-4 h-4 text-indigo-500" />
                <span>AI学習・マイニング制約</span>
              </div>
              <div className="pl-6 bg-indigo-50 border border-indigo-100 rounded-lg p-3">
                <p className="text-sm text-indigo-900 font-medium">
                  このコンテンツはAI学習・推論への使用が制限されています
                </p>
              </div>
            </div>
          )}

          {/* 透かし情報 */}
          {importantInfo.watermarks > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <Lock className="w-4 h-4 text-indigo-500" />
                <span>デジタル透かし</span>
              </div>
              <div className="pl-6 bg-gray-50 border border-gray-200 rounded-lg p-3">
                <p className="text-sm text-gray-700">
                  {importantInfo.watermarks}個のデジタル透かしが埋め込まれています
                </p>
              </div>
            </div>
          )}

          {/* 位置情報・カメラ情報 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <MapPin className="w-4 h-4 text-indigo-500" />
              <span>プライバシー関連情報</span>
            </div>
            <div className="pl-6 space-y-2">
              <div className="flex items-center justify-between py-1.5">
                <span className="text-sm text-gray-600">位置情報</span>
                <span className={`text-sm font-medium px-3 py-1 rounded-full ${importantInfo.hasLocation ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
                  {importantInfo.hasLocation ? '含まれています' : '含まれていません'}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-sm text-gray-600">Exif情報（カメラ設定等）</span>
                <span className={`text-sm font-medium px-3 py-1 rounded-full ${importantInfo.hasExif ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
                  {importantInfo.hasExif ? '含まれています' : '含まれていません'}
                </span>
              </div>
            </div>
          </div>

          {/* 詳細情報ボタン（横並び） */}
          <div className="pt-4 border-t border-gray-200">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* 来歴情報 */}
              <Button
                onClick={() => setShowProvenanceModal(true)}
                variant="outline"
                className="border-indigo-200 hover:bg-indigo-50 hover:border-indigo-300"
              >
                <GitBranch className="w-4 h-4 mr-2" />
                タイムライン
              </Button>
              {/* すべてのメタデータ詳細 */}
              <Button
                onClick={() => setShowAllMetadataModal(true)}
                variant="outline"
                className="border-gray-200 hover:bg-gray-50"
              >
                <Code className="w-4 h-4 mr-2" />
                メタデータの詳細
              </Button>
              {/* 仕組みとデータ取り扱い */}
              <Button
                onClick={() => setShowTechnicalModal(true)}
                variant="outline"
                className="border-gray-200 hover:bg-gray-50"
              >
                <BookOpen className="w-4 h-4 mr-2" />
                データの取り扱い技術
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 同意チェックボックス */}
      <div className="bg-indigo-50 border-2 border-indigo-200 rounded-xl p-6 shadow-sm">
        <label className="flex items-start gap-4 cursor-pointer group">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => onAcknowledge(e.target.checked)}
            className="mt-0.5 w-6 h-6 text-indigo-600 rounded-md focus:ring-2 focus:ring-indigo-500 cursor-pointer"
          />
          <div className="flex-1">
            <span className="font-semibold text-indigo-900 block mb-1.5 text-base">
              公開に同意する
            </span>
            <span className="text-sm text-indigo-800 leading-relaxed">
              上記の情報とファイル本体が公開されることを理解し、同意します。
            </span>
          </div>
        </label>
      </div>

      {/* 来歴モーダル */}
      <ProvenanceModal
        isOpen={showProvenanceModal}
        onClose={() => setShowProvenanceModal(false)}
        c2paSummary={c2paSummary}
        rootSigner={rootSigner}
      />

      {/* 仕組みとデータ取り扱いモーダル */}
      <Dialog open={showTechnicalModal} onOpenChange={setShowTechnicalModal}>
        <DialogContent className="max-w-4xl max-h-[90vh] p-0">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>仕組みとデータの取り扱いについて</DialogTitle>
            <DialogDescription>
              RootLensがどのように真正性を証明するか、詳しい技術情報
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="px-6 pb-6 max-h-[calc(90vh-8rem)]">
            <TechnicalDetailsSection />
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* すべての技術情報モーダル */}
      <Dialog open={showAllMetadataModal} onOpenChange={setShowAllMetadataModal}>
        <DialogContent className="max-w-4xl max-h-[90vh] p-0">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>すべての技術情報</DialogTitle>
            <DialogDescription>
              このファイルに含まれるすべてのC2PAメタデータ（開発者・専門家向け）
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="px-6 pb-6 max-h-[calc(90vh-8rem)]">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              {allMetadata.map((item, index) => {
                // JSON文字列かどうか判定（改行を含むか、[]や{}で始まる）
                const isJson = item.value.includes('\n') || item.value.startsWith('[') || item.value.startsWith('{');

                return (
                  <div key={index} className={`flex flex-col ${isJson ? 'md:col-span-2' : ''}`}>
                    <p className="text-gray-500 text-xs mb-0.5">{item.label}</p>
                    {isJson ? (
                      <pre className="text-gray-900 text-xs bg-gray-50 p-2 rounded border border-gray-200 overflow-x-auto">
                        {item.value}
                      </pre>
                    ) : (
                      <p className="text-gray-900 font-medium break-all">{item.value}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
