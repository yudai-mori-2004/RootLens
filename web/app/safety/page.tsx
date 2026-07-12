import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import SiteLayout from "../../components/shared/SiteLayout";
import s from "../../components/lp/lp.module.css";

// /safety — 児童保護基準 (CSAE ポリシー)。 アプリストアの掲載要件として公開する。
// 内容は privacy-policy §8/§13 (児童を被写体にしない・違法物は通報) と整合させる。

const CONTACT_EMAIL = "contact@rootlens.io";

export const metadata: Metadata = {
  title: "Child Safety Standards – RootLens",
  description: "RootLens child safety standards, CSAE policy, and reporting procedures.",
};

const CONTENT = {
  ja: {
    label: "Safety",
    title: "児童保護基準",
    subtitle: "児童への性的虐待・搾取 (CSAE) を防ぐための、RootLensの方針と手続きです。",
    sections: [
      {
        h: "1. 児童に関するコンテンツを許容しません",
        p: [
          "RootLensは、児童性的虐待コンテンツ (CSAM) および児童を搾取・危険にさらすあらゆるコンテンツを一切許容しません。RootLensのデータ収集では児童を被写体にすることを認めておらず、撮影者は18歳以上であることを求めます。違反したアカウントは直ちに停止し、関係当局に通報します。",
        ],
        list: [],
      },
      {
        h: "2. 予防の仕組み",
        p: [
          "RootLensは、同意を得た事業者の現場で、当社が発行したアカウントを使って作業映像を収集する非公開のサービスです。誰でも投稿できる公開プラットフォームではありません。そのうえで、次の対策を取っています。",
        ],
        list: [
          "アカウントは当社が現場ごとに発行し、すべての映像が特定のアカウントに紐づきます",
          "映像は一般公開されず、確認を経て研究開発目的の提供先にのみ渡ります",
          "クリップは提供前に1本ずつ確認し、方針に反するものは提供対象から除外・削除します",
          "違法なコンテンツを検知した場合は、法令に従い対応し、捜査機関に全面的に協力します",
        ],
      },
      {
        h: "3. 通報",
        p: [
          "RootLensが扱うデータについて、児童への性的虐待・搾取に関わる懸念を見つけた場合は、直ちに次の窓口へご連絡ください。",
        ],
        list: [`メール: ${CONTACT_EMAIL} (件名に「CSAE Report」とご記入ください)`],
        after:
          "すべての通報を速やかに確認します。確認されたCSAMは、法令に従い警察および関係機関へ通報し、国内外の捜査機関に協力します。",
      },
      {
        h: "4. 法令の遵守",
        p: [
          "RootLensは、児童保護に関する適用法令および通報義務を遵守します。捜査機関・児童保護団体と連携し、児童の安全確保に取り組みます。",
        ],
        list: [],
      },
      {
        h: "5. 連絡先",
        p: [`本基準に関するお問い合わせ: ${CONTACT_EMAIL}`],
        list: [],
      },
    ],
    updated: "最終更新: 2026年7月12日",
  },
  en: {
    label: "Safety",
    title: "Child Safety Standards",
    subtitle: "RootLens's policy and procedures for preventing child sexual abuse and exploitation (CSAE).",
    sections: [
      {
        h: "1. Zero tolerance",
        p: [
          "RootLens has a zero-tolerance policy for child sexual abuse material (CSAM) and any content that exploits or endangers children. Children must not appear in RootLens recordings, and recording users must be 18 or older. Violating accounts are terminated immediately and reported to the relevant authorities.",
        ],
        list: [],
      },
      {
        h: "2. Prevention",
        p: [
          "RootLens is a closed service that records work footage at consenting workplaces using accounts we issue. It is not a public platform anyone can upload to. On top of that, we take the following measures.",
        ],
        list: [
          "Accounts are issued by us per site, and every recording is tied to a specific account",
          "Footage is never published publicly; after review it goes only to R&D recipients",
          "Every clip is reviewed before delivery, and clips violating this policy are excluded and deleted",
          "Detected illegal material is handled as required by law, with full cooperation with law enforcement",
        ],
      },
      {
        h: "3. Reporting",
        p: [
          "If you have a concern that data handled by RootLens involves child sexual abuse or exploitation, please contact us immediately.",
        ],
        list: [`Email: ${CONTACT_EMAIL} (subject line "CSAE Report")`],
        after:
          "All reports are reviewed promptly. Confirmed CSAM is reported to the police and relevant authorities as required by law, and we cooperate with domestic and international law enforcement.",
      },
      {
        h: "4. Legal compliance",
        p: [
          "RootLens complies with applicable child safety laws and reporting obligations, and works with law enforcement and child protection organizations to keep children safe.",
        ],
        list: [],
      },
      {
        h: "5. Contact",
        p: [`Questions about these standards: ${CONTACT_EMAIL}`],
        list: [],
      },
    ],
    updated: "Last updated: July 12, 2026",
  },
} as const;

export default async function SafetyPage() {
  const locale = await getLocale();
  const c = CONTENT[locale === "ja" ? "ja" : "en"];

  return (
    <SiteLayout>
      <div className={s.page}>
        <section className={s.section}>
          <div className={s.sectionInner}>
            <header className={s.sectionHeader}>
              <div>
                <div className={s.sectionLabel}>{c.label}</div>
                <h1 className={s.sectionTitle}>{c.title}</h1>
              </div>
            </header>
            <div className={s.sectionBody}>
              <p className={s.prose}>{c.subtitle}</p>
              {c.sections.map((sec) => (
                <div key={sec.h}>
                  <h2
                    className={s.prose}
                    style={{ marginTop: 40, marginBottom: 10, fontWeight: 900, color: "#fff", fontSize: "1.25rem" }}
                  >
                    {sec.h}
                  </h2>
                  {sec.p.map((para) => (
                    <p key={para} className={s.prose}>
                      {para}
                    </p>
                  ))}
                  {sec.list.length > 0 && (
                    <ul style={{ paddingLeft: 22, margin: "12px 0 16px" }}>
                      {sec.list.map((item) => (
                        <li key={item} className={s.prose} style={{ marginBottom: 8 }}>
                          {item}
                        </li>
                      ))}
                    </ul>
                  )}
                  {"after" in sec && sec.after && <p className={s.prose}>{sec.after}</p>}
                </div>
              ))}
              <p className={s.prose} style={{ marginTop: 40, opacity: 0.6 }}>
                {c.updated}
              </p>
            </div>
          </div>
        </section>
      </div>
    </SiteLayout>
  );
}
