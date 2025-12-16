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
                <div className="relative bg-slate-50 rounded-2xl p-8 border border-slate-200 shadow-sm">
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-4 p-4 bg-white rounded-xl shadow-sm border border-slate-100">
                      <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center text-red-600">
                        <X className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="font-bold text-slate-900">{t('why.aiImage.title')}</div>
                        <div className="text-sm text-slate-500">{t('why.aiImage.desc')}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 p-4 bg-white rounded-xl shadow-sm border border-blue-100 ring-2 ring-blue-500/20">
                      <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600">
                        <Check className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="font-bold text-slate-900">{t('why.rootLensImage.title')}</div>
                        <div className="text-sm text-slate-500">
                          {t.rich('why.rootLensImage.desc', {
                            strong: (chunks) => <span className="font-medium text-blue-600">{chunks}</span>
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
        <section id="technology" className="py-24 bg-slate-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <Badge variant="outline" className="mb-4">{t('technology.badge')}</Badge>
              <h2 className="text-3xl font-bold text-slate-900">{t('technology.title')}</h2>
              <p className="mt-4 text-lg text-slate-600 max-w-2xl mx-auto">
                {t('technology.description')}
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-8 mb-16">
              <Card className="border-blue-200 bg-blue-50/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-blue-700">
                    <Shield className="w-6 h-6" />
                    {t('technology.c2pa.title')}
                  </CardTitle>
                  <CardDescription>{t('technology.c2pa.desc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-start gap-2">
                    <Check className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                    <span className="text-slate-700">{t('technology.c2pa.point1')}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                    <span className="text-slate-700">{t('technology.c2pa.point2')}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                    <span className="text-slate-700">{t('technology.c2pa.point3')}</span>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-purple-200 bg-purple-50/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-purple-700">
                    <Coins className="w-6 h-6" />
                    {t('technology.blockchain.title')}
                  </CardTitle>
                  <CardDescription>{t('technology.blockchain.desc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-start gap-2">
                    <Check className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" />
                    <span className="text-slate-700">{t('technology.blockchain.point1')}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" />
                    <span className="text-slate-700">{t('technology.blockchain.point2')}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" />
                    <span className="text-slate-700">{t('technology.blockchain.point3')}</span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Web2 vs Web3 Comparison */}
            <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
              <div className="p-8 border-b bg-slate-50/50">
                <h3 className="text-xl font-bold text-center">{t('technology.comparison.title')}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/50 text-slate-500 text-sm">
                      <th className="p-4 font-medium border-b">{t('technology.comparison.headers.feature')}</th>
                      <th className="p-4 font-medium border-b">{t('technology.comparison.headers.web2')}</th>
                      <th className="p-4 font-medium border-b bg-blue-50/50 text-blue-700">{t('technology.comparison.headers.web3')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr>
                      <td className="p-4 font-medium text-slate-900">{t('technology.comparison.rows.authenticity.label')}</td>
                      <td className="p-4 text-slate-600">{t('technology.comparison.rows.authenticity.web2')}</td>
                      <td className="p-4 text-slate-900 bg-blue-50/30 font-medium">{t('technology.comparison.rows.authenticity.web3')}</td>
                    </tr>
                    <tr>
                      <td className="p-4 font-medium text-slate-900">{t('technology.comparison.rows.ownership.label')}</td>
                      <td className="p-4 text-slate-600">{t('technology.comparison.rows.ownership.web2')}</td>
                      <td className="p-4 text-slate-900 bg-blue-50/30 font-medium">{t('technology.comparison.rows.ownership.web3')}</td>
                    </tr>
                    <tr>
                      <td className="p-4 font-medium text-slate-900">{t('technology.comparison.rows.leak.label')}</td>
                      <td className="p-4 text-slate-600 text-red-500">{t('technology.comparison.rows.leak.web2')}</td>
                      <td className="p-4 text-slate-900 bg-blue-50/30 font-medium">{t('technology.comparison.rows.leak.web3')}</td>
                    </tr>
                    <tr>
                      <td className="p-4 font-medium text-slate-900">{t('technology.comparison.rows.liquidity.label')}</td>
                      <td className="p-4 text-slate-600 text-red-500">{t('technology.comparison.rows.liquidity.web2')}</td>
                      <td className="p-4 text-slate-900 bg-blue-50/30 font-medium">{t('technology.comparison.rows.liquidity.web3')}</td>
                    </tr>
                    <tr>
                      <td className="p-4 font-medium text-slate-900">{t('technology.comparison.rows.takeover.label')}</td>
                      <td className="p-4 text-slate-600">{t('technology.comparison.rows.takeover.web2')}</td>
                      <td className="p-4 text-slate-900 bg-blue-50/30 font-medium">{t('technology.comparison.rows.takeover.web3')}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {/* 3 Core Values */}
        <section id="values" className="py-24 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold text-center mb-16 text-slate-900">{t('values.title')}</h2>
            <div className="grid md:grid-cols-3 gap-10">
              <div className="space-y-4">
                <div className="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center text-blue-600 mb-4">
                  <Camera className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 whitespace-pre-line">{t('values.value1.title')}</h3>
                <p className="text-slate-600 leading-relaxed">
                  {t('values.value1.desc')}
                </p>
              </div>
              <div className="space-y-4">
                <div className="w-14 h-14 bg-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600 mb-4">
                  <Lock className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 whitespace-pre-line">{t('values.value2.title')}</h3>
                <p className="text-slate-600 leading-relaxed">
                  {t('values.value2.desc')}
                </p>
              </div>
              <div className="space-y-4">
                <div className="w-14 h-14 bg-purple-100 rounded-2xl flex items-center justify-center text-purple-600 mb-4">
                  <Search className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 whitespace-pre-line">{t('values.value3.title')}</h3>
                <p className="text-slate-600 leading-relaxed">
                  {t('values.value3.desc')}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Target Users */}
        <section className="py-24 bg-slate-900 text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid md:grid-cols-2 gap-16">
              <div>
                <h3 className="text-2xl font-bold mb-8 flex items-center gap-3">
                  <span className="text-blue-400">{t('target.creator.title')}</span>
                  <span>{t('target.creator.subtitle')}</span>
                </h3>
                <ul className="space-y-6">
                  <li className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold shrink-0">1</div>
                    <div>
                      <h4 className="font-bold text-lg mb-1">{t('target.creator.item1.title')}</h4>
                      <p className="text-slate-400 text-sm">{t('target.creator.item1.desc')}</p>
                    </div>
                  </li>
                  <li className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold shrink-0">2</div>
                    <div>
                      <h4 className="font-bold text-lg mb-1">{t('target.creator.item2.title')}</h4>
                      <p className="text-slate-400 text-sm">{t('target.creator.item2.desc')}</p>
                    </div>
                  </li>
                  <li className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold shrink-0">3</div>
                    <div>
                      <h4 className="font-bold text-lg mb-1">{t('target.creator.item3.title')}</h4>
                      <p className="text-slate-400 text-sm">{t('target.creator.item3.desc')}</p>
                    </div>
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="text-2xl font-bold mb-8 flex items-center gap-3">
                  <span className="text-purple-400">{t('target.consumer.title')}</span>
                  <span>{t('target.consumer.subtitle')}</span>
                </h3>
                <ul className="space-y-6">
                  <li className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold shrink-0">1</div>
                    <div>
                      <h4 className="font-bold text-lg mb-1">{t('target.consumer.item1.title')}</h4>
                      <p className="text-slate-400 text-sm">{t('target.consumer.item1.desc')}</p>
                    </div>
                  </li>
                  <li className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold shrink-0">2</div>
                    <div>
                      <h4 className="font-bold text-lg mb-1">{t('target.consumer.item2.title')}</h4>
                      <p className="text-slate-400 text-sm">{t('target.consumer.item2.desc')}</p>
                    </div>
                  </li>
                  <li className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold shrink-0">3</div>
                    <div>
                      <h4 className="font-bold text-lg mb-1">{t('target.consumer.item3.title')}</h4>
                      <p className="text-slate-400 text-sm">{t('target.consumer.item3.desc')}</p>
                    </div>
                  </li>
                </ul>
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