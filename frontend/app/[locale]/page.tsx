import { Link } from '@/lib/navigation';
import Image from 'next/image';
import Header from '@/app/components/Header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Check, X, Shield, Coins, Search, Camera, Lock, ArrowRight, ExternalLink, X as XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

export default function Home() {
  const t = useTranslations('home');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 text-slate-900 font-sans">
      <Header isLandingPage={true} />

      <main>
        {/* ヒーローセクション */}
        <section className="relative pt-20 pb-32 overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-100/50 via-transparent to-transparent opacity-70"></div>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <Badge variant="secondary" className="mb-6 px-4 py-1.5 text-sm font-medium bg-blue-50 text-blue-700 border-blue-100">
              {t('hero.badge')}
            </Badge>
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-extrabold tracking-tight text-slate-900 mb-8 max-w-5xl mx-auto leading-tight">
              <span className="inline-block">{t('hero.title.prefix')}</span>
              <span className="inline-block"><span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600">{t('hero.title.suffix')}</span></span>
            </h1>
            <p className="text-xl text-slate-600 mb-10 max-w-3xl mx-auto leading-relaxed">
              {t('hero.description')}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <Button asChild size="lg" className="h-14 px-8 text-lg rounded-full shadow-lg shadow-blue-600/20 hover:shadow-blue-600/30 transition-all">
                <Link href="/upload">
                  <Camera className="w-5 h-5 mr-2" />
                  {t('hero.buttons.upload')}
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-14 px-8 text-lg rounded-full border-2 hover:bg-slate-50">
                <Link href="/lens">
                  <Search className="w-5 h-5 mr-2" />
                  {t('hero.buttons.search')}
                </Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Why Now: AI時代の信頼の危機 */}
        <section id="why" className="py-24 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid md:grid-cols-2 gap-16 items-center">
              <div>
                <h2 className="text-3xl font-bold mb-6 text-slate-900 whitespace-pre-line">
                  {t('why.title')}
                </h2>
                <div className="space-y-6 text-lg text-slate-600">
                  <p>
                    {t('why.p1')}
                  </p>
                  <p className="font-medium text-slate-800 border-l-4 border-blue-500 pl-4">
                    {t('why.p2')}
                  </p>
                  <p>
                    {t('why.p3')}
                  </p>
                </div>
              </div>
              <div className="relative">
                <div className="absolute -inset-4 bg-gradient-to-tr from-blue-100 to-purple-100 rounded-2xl opacity-50 blur-xl"></div>
                <div className="relative space-y-6">
                  {/* AI Generated - Warning Style */}
                  <div className="group relative overflow-hidden bg-white rounded-2xl border-2 border-red-200 hover:border-red-300 transition-all duration-300 shadow-lg hover:shadow-xl">
                    <div className="absolute inset-0 bg-gradient-to-br from-red-50 via-orange-50/30 to-transparent opacity-60"></div>
                    <div className="relative flex items-center gap-5 p-6">
                      <div className="relative shrink-0">
                        <div className="absolute inset-0 bg-red-500 rounded-2xl blur-xl opacity-20 group-hover:opacity-30 transition-opacity"></div>
                        <div className="relative w-16 h-16 bg-gradient-to-br from-red-500 to-orange-500 rounded-2xl flex items-center justify-center shadow-lg">
                          <X className="w-8 h-8 text-white" strokeWidth={3} />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-lg text-slate-900 mb-1">{t('why.aiImage.title')}</div>
                        <div className="text-sm text-slate-600">{t('why.aiImage.desc')}</div>
                      </div>
                    </div>
                  </div>

                  {/* RootLens - Trust Style */}
                  <div className="group relative overflow-hidden bg-white rounded-2xl border-2 border-blue-300 hover:border-blue-400 transition-all duration-300 shadow-xl hover:shadow-2xl">
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-indigo-50/50 to-purple-50/30"></div>
                    <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-blue-400/10 to-transparent rounded-full blur-2xl"></div>
                    <div className="relative flex items-center gap-5 p-6">
                      <div className="relative shrink-0">
                        <div className="absolute inset-0 bg-blue-500 rounded-2xl blur-xl opacity-20 group-hover:opacity-40 transition-opacity"></div>
                        <div className="relative w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg ring-2 ring-blue-200 group-hover:ring-4 group-hover:ring-blue-300 transition-all">
                          <Check className="w-9 h-9 text-white" strokeWidth={3} />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-lg text-slate-900 mb-1 flex items-center gap-2">
                          {t('why.rootLensImage.title')}
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
                            RootLens
                          </span>
                        </div>
                        <div className="text-sm text-slate-600">
                          {t.rich('why.rootLensImage.desc', {
                            strong: (chunks) => <span className="font-bold text-blue-600">{chunks}</span>
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Technology: C2PA x Blockchain */}
        <section id="technology" className="relative py-24 bg-slate-900 text-white overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-900/20 to-purple-900/20"></div>
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-500/10 via-transparent to-transparent"></div>

          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-20">
              <Badge variant="outline" className="mb-4 border-slate-700 text-slate-300">{t('technology.badge')}</Badge>
              <h2 className="text-4xl md:text-5xl font-bold mb-6">{t('technology.title')}</h2>
              <p className="text-xl text-slate-400 max-w-3xl mx-auto leading-relaxed">
                {t('technology.description')}
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-12 mb-20">
              {/* C2PA - The Proof */}
              <div className="relative group">
                <div className="absolute -inset-6 bg-gradient-to-br from-blue-500/20 to-blue-600/5 rounded-3xl blur-2xl group-hover:from-blue-500/30 group-hover:to-blue-600/10 transition-all duration-500"></div>
                <div className="relative">
                  <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-500/10 backdrop-blur-sm rounded-2xl border border-blue-500/20 mb-6 group-hover:bg-blue-500/20 group-hover:border-blue-500/40 transition-all duration-300">
                    <Shield className="w-7 h-7 text-blue-400" />
                  </div>
                  <h3 className="text-3xl font-bold mb-3 bg-gradient-to-r from-blue-200 to-blue-400 bg-clip-text text-transparent">
                    {t('technology.c2pa.title')}
                  </h3>
                  <p className="text-blue-200 text-lg mb-8 font-medium">{t('technology.c2pa.desc')}</p>
                  <div className="space-y-4">
                    <div className="flex items-start gap-3 group/item">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2.5 group-hover/item:scale-150 transition-transform"></div>
                      <p className="text-slate-300 leading-relaxed">{t('technology.c2pa.point1')}</p>
                    </div>
                    <div className="flex items-start gap-3 group/item">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2.5 group-hover/item:scale-150 transition-transform"></div>
                      <p className="text-slate-300 leading-relaxed">{t('technology.c2pa.point2')}</p>
                    </div>
                    <div className="flex items-start gap-3 group/item">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2.5 group-hover/item:scale-150 transition-transform"></div>
                      <p className="text-slate-300 leading-relaxed">{t('technology.c2pa.point3')}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Blockchain - The Ownership */}
              <div className="relative group">
                <div className="absolute -inset-6 bg-gradient-to-br from-purple-500/20 to-purple-600/5 rounded-3xl blur-2xl group-hover:from-purple-500/30 group-hover:to-purple-600/10 transition-all duration-500"></div>
                <div className="relative">
                  <div className="inline-flex items-center justify-center w-14 h-14 bg-purple-500/10 backdrop-blur-sm rounded-2xl border border-purple-500/20 mb-6 group-hover:bg-purple-500/20 group-hover:border-purple-500/40 transition-all duration-300">
                    <Lock className="w-7 h-7 text-purple-400" />
                  </div>
                  <h3 className="text-3xl font-bold mb-3 bg-gradient-to-r from-purple-200 to-purple-400 bg-clip-text text-transparent">
                    {t('technology.blockchain.title')}
                  </h3>
                  <p className="text-purple-200 text-lg mb-8 font-medium">{t('technology.blockchain.desc')}</p>
                  <div className="space-y-4">
                    <div className="flex items-start gap-3 group/item">
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-400 mt-2.5 group-hover/item:scale-150 transition-transform"></div>
                      <p className="text-slate-300 leading-relaxed">{t('technology.blockchain.point1')}</p>
                    </div>
                    <div className="flex items-start gap-3 group/item">
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-400 mt-2.5 group-hover/item:scale-150 transition-transform"></div>
                      <p className="text-slate-300 leading-relaxed">{t('technology.blockchain.point2')}</p>
                    </div>
                    <div className="flex items-start gap-3 group/item">
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-400 mt-2.5 group-hover/item:scale-150 transition-transform"></div>
                      <p className="text-slate-300 leading-relaxed">{t('technology.blockchain.point3')}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Web2 vs Web3 Comparison */}
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-slate-700/50 overflow-hidden">
              <div className="p-8 border-b border-slate-700/50 bg-slate-800/30">
                <h3 className="text-2xl font-bold text-center">{t('technology.comparison.title')}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-800/50 text-slate-400 text-sm">
                      <th className="p-4 font-medium border-b border-slate-700/50">{t('technology.comparison.headers.feature')}</th>
                      <th className="p-4 font-medium border-b border-slate-700/50">{t('technology.comparison.headers.web2')}</th>
                      <th className="p-4 font-medium border-b border-slate-700/50 bg-blue-500/10 text-blue-400">{t('technology.comparison.headers.web3')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/30">
                    <tr className="hover:bg-slate-800/30 transition-colors">
                      <td className="p-4 font-medium text-white">{t('technology.comparison.rows.authenticity.label')}</td>
                      <td className="p-4 text-slate-400">{t('technology.comparison.rows.authenticity.web2')}</td>
                      <td className="p-4 text-white bg-blue-500/5 font-medium">{t('technology.comparison.rows.authenticity.web3')}</td>
                    </tr>
                    <tr className="hover:bg-slate-800/30 transition-colors">
                      <td className="p-4 font-medium text-white">{t('technology.comparison.rows.ownership.label')}</td>
                      <td className="p-4 text-slate-400">{t('technology.comparison.rows.ownership.web2')}</td>
                      <td className="p-4 text-white bg-blue-500/5 font-medium">{t('technology.comparison.rows.ownership.web3')}</td>
                    </tr>
                    <tr className="hover:bg-slate-800/30 transition-colors">
                      <td className="p-4 font-medium text-white">{t('technology.comparison.rows.leak.label')}</td>
                      <td className="p-4 text-slate-400 text-red-400">{t('technology.comparison.rows.leak.web2')}</td>
                      <td className="p-4 text-white bg-blue-500/5 font-medium">{t('technology.comparison.rows.leak.web3')}</td>
                    </tr>
                    <tr className="hover:bg-slate-800/30 transition-colors">
                      <td className="p-4 font-medium text-white">{t('technology.comparison.rows.liquidity.label')}</td>
                      <td className="p-4 text-slate-400 text-red-400">{t('technology.comparison.rows.liquidity.web2')}</td>
                      <td className="p-4 text-white bg-blue-500/5 font-medium">{t('technology.comparison.rows.liquidity.web3')}</td>
                    </tr>
                    <tr className="hover:bg-slate-800/30 transition-colors">
                      <td className="p-4 font-medium text-white">{t('technology.comparison.rows.takeover.label')}</td>
                      <td className="p-4 text-slate-400">{t('technology.comparison.rows.takeover.web2')}</td>
                      <td className="p-4 text-white bg-blue-500/5 font-medium">{t('technology.comparison.rows.takeover.web3')}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {/* 3 Core Values */}
        <section id="values" className="relative py-24 bg-gradient-to-b from-white via-slate-50 to-white overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-50 via-transparent to-transparent opacity-40"></div>

          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-4xl font-bold text-center mb-20 text-slate-900">{t('values.title')}</h2>
            <div className="grid md:grid-cols-3 gap-8">
              {/* Value 1: Marketplace */}
              <div className="group relative">
                <div className="absolute -inset-4 bg-gradient-to-br from-blue-200/40 via-blue-100/20 to-transparent rounded-3xl blur-2xl opacity-0 group-hover:opacity-100 transition-all duration-500"></div>
                <div className="relative bg-white border-2 border-slate-200 hover:border-blue-300 rounded-3xl p-8 shadow-lg hover:shadow-2xl transition-all duration-300">
                  <div className="relative mb-6">
                    <div className="absolute inset-0 bg-blue-500 rounded-2xl blur-xl opacity-20 group-hover:opacity-30 transition-opacity"></div>
                    <div className="relative w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
                      <Camera className="w-8 h-8 text-white" strokeWidth={2.5} />
                    </div>
                  </div>
                  <h3 className="text-2xl font-bold text-slate-900 mb-4 whitespace-pre-line leading-tight">{t('values.value1.title')}</h3>
                  <p className="text-slate-600 leading-relaxed">
                    {t('values.value1.desc')}
                  </p>
                </div>
              </div>

              {/* Value 2: Ownership */}
              <div className="group relative">
                <div className="absolute -inset-4 bg-gradient-to-br from-indigo-200/40 via-indigo-100/20 to-transparent rounded-3xl blur-2xl opacity-0 group-hover:opacity-100 transition-all duration-500"></div>
                <div className="relative bg-white border-2 border-slate-200 hover:border-indigo-300 rounded-3xl p-8 shadow-lg hover:shadow-2xl transition-all duration-300">
                  <div className="relative mb-6">
                    <div className="absolute inset-0 bg-indigo-500 rounded-2xl blur-xl opacity-20 group-hover:opacity-30 transition-opacity"></div>
                    <div className="relative w-16 h-16 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
                      <Lock className="w-8 h-8 text-white" strokeWidth={2.5} />
                    </div>
                  </div>
                  <h3 className="text-2xl font-bold text-slate-900 mb-4 whitespace-pre-line leading-tight">{t('values.value2.title')}</h3>
                  <p className="text-slate-600 leading-relaxed">
                    {t('values.value2.desc')}
                  </p>
                </div>
              </div>

              {/* Value 3: Lens Search */}
              <div className="group relative">
                <div className="absolute -inset-4 bg-gradient-to-br from-purple-200/40 via-purple-100/20 to-transparent rounded-3xl blur-2xl opacity-0 group-hover:opacity-100 transition-all duration-500"></div>
                <div className="relative bg-white border-2 border-slate-200 hover:border-purple-300 rounded-3xl p-8 shadow-lg hover:shadow-2xl transition-all duration-300">
                  <div className="relative mb-6">
                    <div className="absolute inset-0 bg-purple-500 rounded-2xl blur-xl opacity-20 group-hover:opacity-30 transition-opacity"></div>
                    <div className="relative w-16 h-16 bg-gradient-to-br from-purple-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
                      <Search className="w-8 h-8 text-white" strokeWidth={2.5} />
                    </div>
                  </div>
                  <h3 className="text-2xl font-bold text-slate-900 mb-4 whitespace-pre-line leading-tight">{t('values.value3.title')}</h3>
                  <p className="text-slate-600 leading-relaxed">
                    {t('values.value3.desc')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Target Users */}
        <section className="relative py-24 bg-slate-900 text-white overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-900/10 to-purple-900/10"></div>
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,_var(--tw-gradient-stops))] from-blue-500/5 via-transparent to-transparent"></div>

          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid md:grid-cols-2 gap-12">
              {/* Creators Side */}
              <div>
                <h3 className="text-3xl font-bold mb-10 flex items-center gap-3">
                  <span className="bg-gradient-to-r from-blue-400 to-blue-500 bg-clip-text text-transparent">{t('target.creator.title')}</span>
                  <span className="text-slate-400 text-xl">{t('target.creator.subtitle')}</span>
                </h3>
                <div className="space-y-4">
                  <div className="group relative">
                    <div className="absolute -inset-2 bg-gradient-to-r from-blue-500/10 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 blur transition-all duration-300"></div>
                    <div className="relative flex gap-4 p-5 bg-slate-800/30 backdrop-blur-sm rounded-2xl border border-slate-700/50 hover:border-blue-500/30 transition-all duration-300">
                      <div className="relative shrink-0">
                        <div className="absolute inset-0 bg-blue-500 rounded-full blur-lg opacity-20 group-hover:opacity-40 transition-opacity"></div>
                        <div className="relative w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center font-bold text-lg shadow-lg">
                          1
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-lg mb-2 text-white">{t('target.creator.item1.title')}</h4>
                        <p className="text-slate-400 text-sm leading-relaxed">{t('target.creator.item1.desc')}</p>
                      </div>
                    </div>
                  </div>

                  <div className="group relative">
                    <div className="absolute -inset-2 bg-gradient-to-r from-blue-500/10 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 blur transition-all duration-300"></div>
                    <div className="relative flex gap-4 p-5 bg-slate-800/30 backdrop-blur-sm rounded-2xl border border-slate-700/50 hover:border-blue-500/30 transition-all duration-300">
                      <div className="relative shrink-0">
                        <div className="absolute inset-0 bg-blue-500 rounded-full blur-lg opacity-20 group-hover:opacity-40 transition-opacity"></div>
                        <div className="relative w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center font-bold text-lg shadow-lg">
                          2
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-lg mb-2 text-white">{t('target.creator.item2.title')}</h4>
                        <p className="text-slate-400 text-sm leading-relaxed">{t('target.creator.item2.desc')}</p>
                      </div>
                    </div>
                  </div>

                  <div className="group relative">
                    <div className="absolute -inset-2 bg-gradient-to-r from-blue-500/10 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 blur transition-all duration-300"></div>
                    <div className="relative flex gap-4 p-5 bg-slate-800/30 backdrop-blur-sm rounded-2xl border border-slate-700/50 hover:border-blue-500/30 transition-all duration-300">
                      <div className="relative shrink-0">
                        <div className="absolute inset-0 bg-blue-500 rounded-full blur-lg opacity-20 group-hover:opacity-40 transition-opacity"></div>
                        <div className="relative w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center font-bold text-lg shadow-lg">
                          3
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-lg mb-2 text-white">{t('target.creator.item3.title')}</h4>
                        <p className="text-slate-400 text-sm leading-relaxed">{t('target.creator.item3.desc')}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Consumers Side */}
              <div>
                <h3 className="text-3xl font-bold mb-10 flex items-center gap-3">
                  <span className="bg-gradient-to-r from-purple-400 to-purple-500 bg-clip-text text-transparent">{t('target.consumer.title')}</span>
                  <span className="text-slate-400 text-xl">{t('target.consumer.subtitle')}</span>
                </h3>
                <div className="space-y-4">
                  <div className="group relative">
                    <div className="absolute -inset-2 bg-gradient-to-r from-purple-500/10 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 blur transition-all duration-300"></div>
                    <div className="relative flex gap-4 p-5 bg-slate-800/30 backdrop-blur-sm rounded-2xl border border-slate-700/50 hover:border-purple-500/30 transition-all duration-300">
                      <div className="relative shrink-0">
                        <div className="absolute inset-0 bg-purple-500 rounded-full blur-lg opacity-20 group-hover:opacity-40 transition-opacity"></div>
                        <div className="relative w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center font-bold text-lg shadow-lg">
                          1
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-lg mb-2 text-white">{t('target.consumer.item1.title')}</h4>
                        <p className="text-slate-400 text-sm leading-relaxed">{t('target.consumer.item1.desc')}</p>
                      </div>
                    </div>
                  </div>

                  <div className="group relative">
                    <div className="absolute -inset-2 bg-gradient-to-r from-purple-500/10 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 blur transition-all duration-300"></div>
                    <div className="relative flex gap-4 p-5 bg-slate-800/30 backdrop-blur-sm rounded-2xl border border-slate-700/50 hover:border-purple-500/30 transition-all duration-300">
                      <div className="relative shrink-0">
                        <div className="absolute inset-0 bg-purple-500 rounded-full blur-lg opacity-20 group-hover:opacity-40 transition-opacity"></div>
                        <div className="relative w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center font-bold text-lg shadow-lg">
                          2
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-lg mb-2 text-white">{t('target.consumer.item2.title')}</h4>
                        <p className="text-slate-400 text-sm leading-relaxed">{t('target.consumer.item2.desc')}</p>
                      </div>
                    </div>
                  </div>

                  <div className="group relative">
                    <div className="absolute -inset-2 bg-gradient-to-r from-purple-500/10 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 blur transition-all duration-300"></div>
                    <div className="relative flex gap-4 p-5 bg-slate-800/30 backdrop-blur-sm rounded-2xl border border-slate-700/50 hover:border-purple-500/30 transition-all duration-300">
                      <div className="relative shrink-0">
                        <div className="absolute inset-0 bg-purple-500 rounded-full blur-lg opacity-20 group-hover:opacity-40 transition-opacity"></div>
                        <div className="relative w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center font-bold text-lg shadow-lg">
                          3
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-lg mb-2 text-white">{t('target.consumer.item3.title')}</h4>
                        <p className="text-slate-400 text-sm leading-relaxed">{t('target.consumer.item3.desc')}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="py-24 bg-white">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold text-center mb-12 text-slate-900">{t('faq.title')}</h2>
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="item-1">
                <AccordionTrigger>{t('faq.q1.q')}</AccordionTrigger>
                <AccordionContent>
                  {t('faq.q1.a')}
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-2">
                <AccordionTrigger>{t('faq.q2.q')}</AccordionTrigger>
                <AccordionContent>
                  {t('faq.q2.a')}
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-3">
                <AccordionTrigger>{t('faq.q3.q')}</AccordionTrigger>
                <AccordionContent>
                  {t('faq.q3.a')}
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-4">
                <AccordionTrigger>{t('faq.q4.q')}</AccordionTrigger>
                <AccordionContent>
                  {t('faq.q4.a')}
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-4">
                <AccordionTrigger>{t('faq.q5.q')}</AccordionTrigger>
                <AccordionContent>
                  {t('faq.q5.a')}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </section>

        {/* Footer / CTA */}
        <footer className="bg-slate-50 border-t border-slate-200 pt-20 pb-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold text-slate-900 mb-6">
                {t('cta.title')}
              </h2>
              <p className="text-lg text-slate-600 mb-8">
                {t('cta.subtitle')}
              </p>
              <Button asChild size="lg" className="h-14 px-10 text-lg rounded-full shadow-xl shadow-blue-600/20">
                <Link href="/upload">
                  {t('cta.button')}
                  <ArrowRight className="ml-2 w-5 h-5" />
                </Link>
              </Button>
            </div>

            <Separator className="my-10" />

            <div className="flex flex-col md:flex-row justify-between items-center gap-6">
              <div className="flex items-center gap-3">
                <Image
                  src="/icon_white.png"
                  alt="RootLens Logo"
                  width={32}
                  height={32}
                  className="rounded-lg opacity-80"
                />
                <span className="font-semibold text-slate-700">RootLens</span>
              </div>
              <div className="flex gap-8 text-sm text-slate-500">
                <Link href="/privacy-policy" className="hover:text-blue-600 transition-colors">Privacy Policy</Link>
                <Link href="/terms" className="hover:text-blue-600 transition-colors">Terms of Service</Link>
                <a href="https://github.com/yudai-mori-2004/RootLens" target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 transition-colors flex items-center gap-1">
                  GitHub <ExternalLink className="w-3 h-3" />
                </a>
                <a href="https://x.com/RootLens_sol" target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 transition-colors flex items-center gap-1">
                  X <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
            <div className="text-center mt-8 text-xs text-slate-400">
              {t('cta.builtWith')}
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}