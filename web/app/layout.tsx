import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Anton, Noto_Sans_JP, DotGothic16 } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// LP-specific fonts。 フライヤー (progress/promo-video) と同じ空気にする:
//   Anton       = 欧文ポスター見出し (極太コンデンス)
//   Noto Sans JP = 本文 (和文はウェイトで殴る)
//   DotGothic16 = ラベル / メタ表示 (ドット文字 = zine の空気)
const anton = Anton({
  variable: "--font-lp-heading",
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
});

const notoSansJp = Noto_Sans_JP({
  variable: "--font-lp-body",
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  display: "swap",
});

const dotGothic = DotGothic16({
  variable: "--font-lp-mono",
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "RootLens",
    template: "%s | RootLens",
  },
  description: "First-person footage of real work, collected with consent and delivered as embodied-AI training data.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();

  return (
    <html lang={locale}>
      <body className={`${geistSans.variable} ${geistMono.variable} ${anton.variable} ${notoSansJp.variable} ${dotGothic.variable}`}>
        <NextIntlClientProvider locale={locale} messages={{}}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
