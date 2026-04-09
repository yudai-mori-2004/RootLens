/**
 * /privacy — Privacy Policy page.
 * Server component for SSR.
 */

import s from "./lp.module.css";

const EFFECTIVE_DATE = "April 2, 2026";
const CONTACT_EMAIL = "contact@titleprotocol.org";

export default async function PrivacyPolicyPage() {
  return (
    <div className={s.page}>
      {/* Hero */}
      <section className={s.hero}>
        <div className={s.heroInner}>
          <h1 className={s.heroTitle}>Privacy Policy</h1>
          <p className={s.heroDescription}>Effective: {EFFECTIVE_DATE}</p>
        </div>
      </section>

      {/* Body */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>1. Overview</h2>
          <p className={s.prose}>
            RootLens (&quot;we&quot;, &quot;our&quot;, or &quot;the App&quot;) is
            a mobile application that lets you prove the authenticity of
            camera-captured content and share it as a verifiable link. This
            Privacy Policy explains what data we collect, how we use it, and your
            rights regarding that data.
          </p>

          <h2 className={s.sectionTitle}>2. Data We Collect</h2>

          <h3 className={s.subsectionTitle}>2.1 Content You Create</h3>
          <p className={s.prose}>
            When you capture or import photos and videos, the App embeds
            cryptographic signatures (C2PA) to prove authenticity. Published
            content is uploaded to cloud storage (Cloudflare R2) and its metadata
            is recorded on the Solana blockchain and off-chain storage. Published content
            is publicly accessible by design.
          </p>

          <h3 className={s.subsectionTitle}>2.2 Device Information</h3>
          <p className={s.prose}>
            To issue a device certificate, we collect platform type (iOS or
            Android) and hardware attestation data. This verifies that the App is
            running on a genuine device. We do not collect device identifiers
            such as IMEI or advertising IDs.
          </p>

          <h3 className={s.subsectionTitle}>2.3 Account Information</h3>
          <p className={s.prose}>
            Authentication is handled by Privy. We store your wallet address and
            optional display name and bio. We do not collect your email address
            or phone number unless provided through Privy login.
          </p>

          <h3 className={s.subsectionTitle}>2.4 Camera and Microphone</h3>
          <p className={s.prose}>
            The App accesses your camera and microphone solely to capture photos
            and videos. Media is processed on-device for signing and editing.
            We do not stream or transmit raw camera data to any server.
          </p>

          <h2 className={s.sectionTitle}>3. How We Use Your Data</h2>
          <ul className={s.prose}>
            <li>Signing content with C2PA cryptographic proofs</li>
            <li>Publishing verified content to public pages</li>
            <li>Recording content metadata on blockchain (Solana) and off-chain storage</li>
            <li>Issuing and renewing device certificates</li>
            <li>Displaying your profile on published content pages</li>
          </ul>

          <h2 className={s.sectionTitle}>4. Third-Party Services</h2>
          <p className={s.prose}>We use the following third-party services:</p>
          <ul className={s.prose}>
            <li>
              <strong>Privy</strong> — authentication and wallet management
            </li>
            <li>
              <strong>Solana</strong> — public blockchain recording
            </li>
            <li>
              <strong>Cloudflare R2</strong> — content storage
            </li>
            <li>
              <strong>Supabase</strong> — database and user management
            </li>
            <li>
              <strong>Vercel</strong> — web hosting
            </li>
          </ul>
          <p className={s.prose}>
            Each service has its own privacy policy. We encourage you to review
            them.
          </p>

          <h2 className={s.sectionTitle}>5. Data Storage and Security</h2>
          <p className={s.prose}>
            Cryptographic keys are stored in your device&apos;s secure hardware
            (Secure Enclave on iOS, StrongBox on Android) and never leave the
            device. Published content and metadata are stored on distributed
            infrastructure (blockchain and cloud storage) and are publicly
            accessible. Unpublished drafts remain on your device only.
          </p>

          <h2 className={s.sectionTitle}>6. Data Retention</h2>
          <p className={s.prose}>
            Published content is recorded on blockchain and is immutable by
            design. Device certificates expire after one year and are
            automatically renewed. You can delete your local data at any time by
            uninstalling the App.
          </p>

          <h2 className={s.sectionTitle}>7. Children&apos;s Privacy</h2>
          <p className={s.prose}>
            RootLens is not intended for children under 13 years of age. We do
            not knowingly collect personal information from children. If you
            believe a child has provided us with personal data, please contact us
            and we will delete it.
          </p>

          <h2 className={s.sectionTitle}>8. Your Rights</h2>
          <p className={s.prose}>
            You may request access to, correction of, or deletion of your
            personal data by contacting us. Note that content published to
            blockchain cannot be modified or deleted due to its immutable nature.
          </p>

          <h2 className={s.sectionTitle}>9. Changes to This Policy</h2>
          <p className={s.prose}>
            We may update this Privacy Policy from time to time. Changes will be
            posted on this page with an updated effective date.
          </p>

          <h2 className={s.sectionTitle}>10. Contact</h2>
          <p className={s.prose}>
            If you have questions about this Privacy Policy, contact us
            at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className={s.link}>
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </div>
      </section>
    </div>
  );
}
