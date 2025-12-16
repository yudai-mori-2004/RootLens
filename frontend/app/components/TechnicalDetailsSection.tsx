'use client';

import { Cloud, BookOpen, AlertTriangle, Database, FileText, Shield } from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import Image from 'next/image';
import { useTranslations } from 'next-intl';

export default function TechnicalDetailsSection() {
  const t = useTranslations('components.technicalDetailsSection');

  return (
    <div className="space-y-10 p-6">
      
      {/* 1. 永久保存データ (Blockchain) */}
      <section className="space-y-4">
        <h4 className="flex items-center gap-3 font-bold text-slate-900 text-lg border-l-4 border-slate-500 pl-4 py-1">
            {t('section1')}
        </h4>
        <div className="bg-white p-6 sm:p-8 rounded-2xl text-base space-y-6 border border-slate-200 shadow-sm">
            <p className="leading-loose text-slate-700">
                {t.rich('section1Desc', {
                    strong: (chunks) => <strong className="text-slate-900 bg-slate-100 px-1 py-0.5 rounded mx-1">{chunks}</strong>
                })}
            </p>

            <div className="bg-slate-50 p-6 rounded-xl border border-slate-200">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">{t('recordedData')}</p>
                <div className="grid grid-cols-1 gap-4">
                     <div className="bg-white p-4 rounded-lg border border-slate-200 flex items-start gap-3">
                        <Database className="w-5 h-5 text-slate-400 mt-1 shrink-0" />
                        <div>
                            <p className="font-bold text-slate-900 text-sm">{t('arweaveData')}</p>
                            <ul className="text-xs text-slate-600 mt-1 space-y-1 list-disc list-inside">
                                {t('arweaveItems').split(',').map((item, i) => (
                                    <li key={i}>{item}</li>
                                ))}
                            </ul>
                        </div>
                     </div>
                     <div className="bg-white p-4 rounded-lg border border-slate-200 flex items-start gap-3">
                        <div className="w-5 h-5 mt-1 shrink-0 relative">
                            <Image src="/solana_logo.png" alt="Solana Logo" fill className="object-contain" />
                        </div>
                        <div>
                            <p className="font-bold text-slate-900 text-sm">{t('solanaData')}</p>
                            <ul className="text-xs text-slate-600 mt-1 space-y-1 list-disc list-inside">
                                {t('solanaItems').split(',').map((item, i) => (
                                    <li key={i}>{item}</li>
                                ))}
                            </ul>
                        </div>
                     </div>
                </div>
                <div className="mt-4 flex items-start gap-2 text-xs text-slate-500 bg-slate-200/50 p-3 rounded-lg">
                    <Shield className="w-4 h-4 shrink-0 mt-0.5" />
                    <p>
                        {t('privacyNote')}
                    </p>
                </div>
            </div>
        </div>
      </section>

      {/* 2. サーバー保存データとプライバシー */}
      <section className="space-y-4">
        <h4 className="flex items-center gap-3 font-bold text-slate-900 text-lg border-l-4 border-indigo-500 pl-4 py-1">
            {t('section2')}
        </h4>
        <div className="bg-gradient-to-br from-indigo-50 to-blue-50 p-6 sm:p-8 rounded-2xl border border-indigo-100 shadow-sm space-y-6">
             <div className="flex items-start gap-4">
                <div className="p-3 bg-white rounded-full shadow-sm shrink-0 text-indigo-600">
                    <Cloud className="w-6 h-6" />
                </div>
                <div>
                    <h5 className="font-bold text-indigo-900 text-lg">{t('section2Title')}</h5>
                    <p className="text-indigo-800 text-sm mt-1 leading-relaxed">
                        {t.rich('section2Desc', {
                            strong: (chunks) => <strong className="text-indigo-700 bg-indigo-100 px-1 rounded mx-1">{chunks}</strong>
                        })}
                        <br/>
                        <span className="text-xs text-slate-500">{t('deleteNote')}</span>
                    </p>
                </div>
             </div>

             <div className="bg-white/80 backdrop-blur-sm p-5 rounded-xl border border-indigo-100 space-y-4">
                <div>
                    <p className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-2">{t('publicContent')}</p>
                    <ul className="space-y-3">
                        <li className="flex items-start gap-3 text-sm text-indigo-900">
                            <FileText className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
                            <div>
                                <span className="font-bold">{t('fileBody')}</span>
                                <p className="text-xs text-indigo-700 mt-1">
                                    {t('fileBodyDesc')}
                                </p>
                            </div>
                        </li>
                        <li className="flex items-start gap-3 text-sm text-indigo-900">
                            <Database className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
                            <div>
                                <span className="font-bold">{t('metadata')}</span>
                                <p className="text-xs text-indigo-700 mt-1">
                                    {t('metadataDesc')}
                                </p>
                            </div>
                        </li>
                    </ul>
                </div>

                <div className="bg-yellow-50 border border-yellow-100 rounded-lg p-4 flex gap-3 items-start">
                    <AlertTriangle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
                    <div className="text-sm text-yellow-800">
                        <p className="font-bold mb-2">{t('privacyImportant')}</p>
                        <p className="leading-relaxed text-xs mb-3">
                            {t.rich('exifWarning', {
                                strong: (chunks) => <strong className="text-yellow-900 bg-yellow-100 px-1 rounded">{chunks}</strong>
                            })}
                        </p>
                        <p className="leading-relaxed text-xs mb-3">
                            {t.rich('tamperWarning', {
                                strong: (chunks) => <strong>{chunks}</strong>
                            })}
                        </p>
                        <ul className="list-disc list-inside text-xs space-y-1 ml-1 font-medium">
                            <li>{t('checkBefore')}</li>
                            <li>
                                {t.rich('stopUpload', {
                                    strong: (chunks) => <strong className="text-red-600 border-b border-red-200">{chunks}</strong>
                                })}
                            </li>
                        </ul>
                    </div>
                </div>
             </div>
        </div>
      </section>

      {/* 3. 証明メカニズム */}
      <section className="space-y-4">
        <h4 className="flex items-center gap-3 font-bold text-slate-900 text-lg border-l-4 border-slate-800 pl-4 py-1">
            {t('section3')}
        </h4>
        <div className="bg-white p-6 sm:p-8 rounded-2xl text-base space-y-8 border border-slate-200 shadow-sm">
            <p className="leading-loose text-slate-700">
                {t.rich('section3Desc', {
                    strong: (chunks) => <strong className="text-slate-900">{chunks}</strong>
                })}
            </p>

            <div className="grid grid-cols-1 gap-4">
                {/* Step 1 */}
                <div className="flex flex-col sm:flex-row gap-4 p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-200 text-slate-600 font-bold shrink-0 text-sm">1</div>
                    <div className="space-y-1 min-w-0 flex-1">
                        <p className="font-bold text-slate-900 text-sm">{t('step1Title')}</p>
                        <p className="text-xs text-slate-600 leading-relaxed">
                            {t('step1Desc')}
                        </p>
                    </div>
                </div>

                {/* Step 2 */}
                <div className="flex flex-col sm:flex-row gap-4 p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-200 text-slate-600 font-bold shrink-0 text-sm">2</div>
                    <div className="space-y-1 min-w-0 flex-1">
                        <p className="font-bold text-slate-900 text-sm">{t('step2Title')}</p>
                        <p className="text-xs text-slate-600 leading-relaxed">
                            {t('step2Desc')}
                        </p>
                    </div>
                </div>

                {/* Step 3 */}
                <div className="flex flex-col sm:flex-row gap-4 p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-200 text-slate-600 font-bold shrink-0 text-sm">3</div>
                    <div className="space-y-1 min-w-0 flex-1">
                        <p className="font-bold text-slate-900 text-sm">{t('step3Title')}</p>
                        <p className="text-xs text-slate-600 leading-relaxed">
                            {t('step3Desc')}
                        </p>
                    </div>
                </div>
            </div>
        </div>
      </section>

      {/* 4. 用語解説 */}
      <section className="space-y-4 border-t border-slate-100 pt-6">
        <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="glossary" className="border-none">
                <AccordionTrigger className="hover:no-underline py-3 px-4 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors">
                    <div className="flex items-center gap-3 text-slate-600 font-bold text-sm">
                        <BookOpen className="w-4 h-4" />
                        <span>{t('glossary')}</span>
                    </div>
                </AccordionTrigger>
                <AccordionContent>
                    <div className="grid grid-cols-1 gap-3 pt-3 px-1">
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                            <dt className="font-bold text-slate-800 text-sm mb-1 flex items-center gap-2">
                                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full" /> {t('hash')}
                            </dt>
                            <dd className="text-xs text-slate-600 leading-relaxed pl-3.5 border-l border-slate-100 ml-1">
                                {t('hashDesc')}
                            </dd>
                        </div>
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                            <dt className="font-bold text-slate-800 text-sm mb-1 flex items-center gap-2">
                                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full" /> {t('rootSignerTerm')}
                            </dt>
                            <dd className="text-xs text-slate-600 leading-relaxed pl-3.5 border-l border-slate-100 ml-1">
                                {t('rootSignerDesc')}
                            </dd>
                        </div>
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                            <dt className="font-bold text-slate-800 text-sm mb-1 flex items-center gap-2">
                                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full" /> {t('arweaveTerm')}
                            </dt>
                            <dd className="text-xs text-slate-600 leading-relaxed pl-3.5 border-l border-slate-100 ml-1">
                                {t('arweaveDesc')}
                            </dd>
                        </div>
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                            <dt className="font-bold text-slate-800 text-sm mb-1 flex items-center gap-2">
                                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full" /> {t('cnftTerm')}
                            </dt>
                            <dd className="text-xs text-slate-600 leading-relaxed pl-3.5 border-l border-slate-100 ml-1">
                                {t('cnftDesc')}
                            </dd>
                        </div>
                    </div>
                </AccordionContent>
            </AccordionItem>
        </Accordion>
      </section>

    </div>
  );
}