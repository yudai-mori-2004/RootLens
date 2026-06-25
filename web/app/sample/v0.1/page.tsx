import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import SamplePage from "../../../components/lp/SamplePage";
import SiteLayout from "../../../components/shared/SiteLayout";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages.sample.meta");
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function Page() {
  return (
    <SiteLayout>
      <SamplePage />
    </SiteLayout>
  );
}
