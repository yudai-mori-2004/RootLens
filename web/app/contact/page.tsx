import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import SiteLayout from "../../components/shared/SiteLayout";
import ContactCard from "../../components/contact/ContactCard";
import s from "../../components/lp/lp.module.css";

const CONTACT_EMAIL = "contact@rootlens.io";

export const metadata: Metadata = {
  title: "RootLens – Contact",
  description: "Contact RootLens by email.",
};

export default async function ContactPage() {
  const t = await getTranslations("pages.contact");

  return (
    <SiteLayout>
      <div className={s.page}>
        <section className={s.section}>
          <div className={s.sectionInner}>
            <header className={s.sectionHeader}>
              <div>
                <div className={s.sectionLabel}>Get in touch</div>
                <h1 className={s.sectionTitle}>{t("title")}</h1>
              </div>
            </header>
            <div className={s.sectionBody}>
              <p className={s.prose}>{t("lead")}</p>
            </div>
            <ContactCard
              email={CONTACT_EMAIL}
              copyLabel={t("copy")}
              copiedLabel={t("copied")}
              openLabel={t("open")}
            />
          </div>
        </section>
      </div>
    </SiteLayout>
  );
}
