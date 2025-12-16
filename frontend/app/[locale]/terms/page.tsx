'use client';

import Header from '@/app/components/Header';
import { BookOpen } from 'lucide-react';
import { useTranslations } from 'next-intl';

export default function TermsPage() {
  const t = useTranslations('legal.terms');
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Header />
      <main className="flex-1 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 md:p-12 text-center">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <BookOpen className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-4">{t('title')}</h1>
          <p className="text-slate-600 text-lg mb-8">
            {t('desc')}
          </p>
          <div className="text-slate-500 text-center text-sm p-4 bg-slate-50 rounded-lg border border-slate-100">
            <p><strong>{t('wip')}</strong></p>
            <p className="mt-2">{t('wait')}</p>
          </div>
        </div>
      </main>
    </div>
  );
}