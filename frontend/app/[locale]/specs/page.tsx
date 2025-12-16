'use client';

import Header from '@/app/components/Header';
import StepContainer from '@/app/components/StepContainer';
import { DEVICE_HASH_SPECS } from '@/app/lib/hash-specs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Smartphone, AlertTriangle } from 'lucide-react';

export default function SpecsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
      <Header />

      <div className="max-w-4xl mx-auto py-12 px-4">
        <StepContainer
          title="RootLens デバイス・ハッシュ仕様"
          description="RootLensがコンテンツの真正なID (originalHash) を抽出するために、各デバイスからのC2PAマニフェストをどのように解釈するかを定義した仕様です。この仕様は、透明性と決定論的なハッシュ生成を保証するために公開されています。"
          showBack={false}
          nextLabel=""
          nextDisabled={true}
        >
          <div className="space-y-8 py-4">
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
                <h5 className="font-bold text-slate-900 text-lg flex items-center gap-2">
                  <Smartphone className="w-5 h-5 text-indigo-500" />
                  デバイス別ハッシュ抽出ルール
                </h5>
                <p className="text-sm text-slate-500 mt-1">
                  以下の表は、特定の `Issuer`（署名発行者）を識別した場合に適用されるルールを示します。
                  これにより、常に同じ署名元から同じコンテンツIDが生成されます。
                </p>
              </div>
              <div className="p-0"> {/* テーブルを直接p-0で囲むことで余計なpaddingをなくす */}
                <Table className="min-w-full divide-y divide-gray-200">
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        ベンダー
                      </TableHead>
                      <TableHead className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Issuer (Matcher)
                      </TableHead>
                      <TableHead className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        採用ハッシュラベル
                      </TableHead>
                      <TableHead className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        説明
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="bg-white divide-y divide-gray-200">
                    {DEVICE_HASH_SPECS.map((spec) => (
                      <TableRow key={spec.id} className="hover:bg-gray-50">
                        <TableCell className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {spec.vendor}
                        </TableCell>
                        <TableCell className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {typeof spec.matcher === 'string' ? spec.matcher : spec.matcher.source}
                        </TableCell>
                        <TableCell className="px-6 py-4 whitespace-nowrap text-sm text-indigo-600 font-mono">
                          {spec.targetLabel}
                        </TableCell>
                        <TableCell className="px-6 py-4 text-sm text-gray-600">
                          {spec.description}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* 未対応デバイスについての注釈 */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl shadow-sm overflow-hidden p-6">
              <h5 className="font-bold text-amber-900 text-lg flex items-center gap-2 mb-3">
                 <AlertTriangle className="w-5 h-5" />
                 リスト外デバイスの取り扱い
              </h5>
              <p className="text-sm text-amber-800 leading-relaxed">
                上記のリストに含まれないデバイスやソフトウェア（信頼された `claimGenerator` と一致しないもの）については、RootLensはハッシュの抽出を行いません（エラーとなります）。
                <br/>
                これはセキュリティ上の措置であり、検証されていない実装による誤ったハッシュ利用や偽装を防ぐためです。
                <br/><br/>
                お使いのデバイスがC2PA対応であるにも関わらずエラーとなる場合は、RootLensチームまでご連絡ください。検証の上、速やかにリストに追加いたします。
              </p>
            </div>
          </div>
        </StepContainer>
      </div>
    </div>
  );
}