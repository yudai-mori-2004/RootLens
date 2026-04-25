import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import NavBar from "../../components/shared/NavBar";
import SiteFooter from "../../components/shared/SiteFooter";
import DocsSidebar from "../../components/docs/DocsSidebar";
import s from "../../components/docs/docs.module.css";

export const metadata = {
  title: {
    default: "Docs",
    template: "%s | RootLens Docs",
  },
  description: "Technical documentation for RootLens and Title Protocol.",
};

export default async function DocsLayout({ children }: { children: React.ReactNode }) {
  const messages = await getMessages();
  // DocsSidebar (client) のみ翻訳を参照する。本文は server の getTranslations で解決。
  const clientMessages = { docs: { sidebar: (messages as { docs?: { sidebar?: unknown } }).docs?.sidebar } };

  return (
    <NextIntlClientProvider messages={clientMessages}>
      <NavBar />
      <div className={s.docsLayout}>
        <DocsSidebar />
        <main className={s.main}>
          {children}
        </main>
      </div>
      <SiteFooter />
    </NextIntlClientProvider>
  );
}
