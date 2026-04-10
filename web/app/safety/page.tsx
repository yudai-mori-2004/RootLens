import SiteLayout from "../../components/shared/SiteLayout";
import s from "../../components/lp/lp.module.css";

export const metadata = {
  title: "Child Safety Standards — RootLens",
  description:
    "RootLens child safety standards, CSAE policy, and reporting procedures.",
};

const CONTACT_EMAIL = "contact@titleprotocol.org";

export default async function SafetyPage() {
  return (
    <SiteLayout>
      <div className={s.page}>
        <section className={s.hero}>
          <div className={s.heroInner}>
            <h1 className={s.heroTitle}>Child Safety Standards</h1>
            <p className={s.heroDescription}>
              Our commitment to preventing child sexual abuse and exploitation
              (CSAE).
            </p>
          </div>
        </section>

        <section className={s.section}>
          <div className={s.sectionInner}>
            <h2 className={s.sectionTitle}>1. Zero-Tolerance Policy</h2>
            <p className={s.prose}>
              RootLens has a zero-tolerance policy for child sexual abuse
              material (CSAM) and any content that exploits or endangers
              children. Any such content is strictly prohibited on our platform.
              Accounts found to be in violation will be immediately terminated
              and reported to the relevant authorities.
            </p>

            <h2 className={s.sectionTitle}>2. Content Moderation</h2>
            <p className={s.prose}>
              RootLens is a content authenticity platform that proves
              camera-captured photos and videos are real and unaltered. All
              published content is publicly accessible and subject to review. We
              employ the following measures to prevent CSAE:
            </p>
            <ul style={{ paddingLeft: 24, margin: "16px 0 40px" }}>
              <li style={{ marginBottom: 8 }}>
                Published content is linked to authenticated user accounts,
                ensuring traceability
              </li>
              <li style={{ marginBottom: 8 }}>
                Cryptographic records on the blockchain provide an immutable
                audit trail for all published content
              </li>
              <li style={{ marginBottom: 8 }}>
                Content that violates this policy is removed immediately upon
                detection or report
              </li>
              <li style={{ marginBottom: 8 }}>
                We cooperate fully with law enforcement investigations
              </li>
            </ul>

            <h2 className={s.sectionTitle}>3. Reporting</h2>
            <p className={s.prose}>
              If you encounter any content on RootLens that you believe involves
              child sexual abuse or exploitation, please report it immediately:
            </p>
            <ul style={{ paddingLeft: 24, margin: "16px 0 40px" }}>
              <li style={{ marginBottom: 8 }}>
                <strong>Email:</strong>{" "}
                <a
                  href={`mailto:${CONTACT_EMAIL}?subject=CSAE%20Report`}
                  style={{ color: "var(--color-accent)" }}
                >
                  {CONTACT_EMAIL}
                </a>
              </li>
              <li style={{ marginBottom: 8 }}>
                <strong>In-app:</strong> Use the three-dot menu on any published
                page to report content
              </li>
            </ul>
            <p className={s.prose}>
              All reports are reviewed promptly. We report confirmed CSAM to the
              National Center for Missing &amp; Exploited Children (NCMEC) and
              cooperate with local and international law enforcement agencies as
              required by applicable laws.
            </p>

            <h2 className={s.sectionTitle}>4. Legal Compliance</h2>
            <p className={s.prose}>
              RootLens complies with all applicable child safety laws and
              regulations, including but not limited to reporting obligations to
              national and regional authorities. We are committed to working
              with law enforcement and child protection organizations to ensure
              the safety of children.
            </p>

            <h2 className={s.sectionTitle}>5. Contact</h2>
            <p className={s.prose}>
              For questions regarding our child safety standards and compliance,
              contact us at{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                style={{ color: "var(--color-accent)" }}
              >
                {CONTACT_EMAIL}
              </a>
              .
            </p>

            <p
              className={s.prose}
              style={{ marginTop: 40, color: "var(--text-tertiary)" }}
            >
              Last updated: April 10, 2026
            </p>
          </div>
        </section>
      </div>
    </SiteLayout>
  );
}
