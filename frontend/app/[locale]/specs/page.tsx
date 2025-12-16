'use client';

import Header from '@/app/components/Header';
import StepContainer from '@/app/components/StepContainer';
import { DEVICE_HASH_SPECS } from '@/app/lib/hash-specs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Smartphone, AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';

export default function SpecsPage() {
  const t = useTranslations('specs');
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
      <Header />

      <div className="max-w-4xl mx-auto py-12 px-4">
        <StepContainer
          title={t('title')}
          description={t('description')}
          showBack={false}
          nextLabel=""
          nextDisabled={true}
        >
          <div className="space-y-8 py-4">
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
                <h5 className="font-bold text-slate-900 text-lg flex items-center gap-2">
                  <Smartphone className="w-5 h-5 text-indigo-500" />
                  {t('cardTitle')}
                </h5>
                <p className="text-sm text-slate-500 mt-1">
                  {t('cardDesc')}
                </p>
              </div>
              <div className="p-0"> {/* テーブルを直接p-0で囲むことで余計なpaddingをなくす */}
                <Table className="min-w-full divide-y divide-gray-200">
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t('headers.vendor')}
                      </TableHead>
                      <TableHead className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t('headers.issuer')}
                      </TableHead>
                      <TableHead className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t('headers.label')}
                      </TableHead>
                      <TableHead className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t('headers.desc')}
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
                 {t('warningTitle')}
              </h5>
              <p className="text-sm text-amber-800 leading-relaxed whitespace-pre-line">
                {t('warningDesc')}
              </p>
            </div>
          </div>
        </StepContainer>
      </div>
    </div>
  );
}