/**
 * /delete-account — Account deletion information page.
 * Server component. Provides instructions for deleting account
 * and lists what data is deleted/retained.
 */

import s from "./lp.module.css";
import d from "./delete.module.css";

const CONTACT_EMAIL = "contact@titleprotocol.org";

export default async function DeleteAccountPage() {
  return (
    <div className={s.page}>
      {/* Hero */}
      <section className={s.hero}>
        <div className={s.heroInner}>
          <h1 className={s.heroTitle}>Delete Account</h1>
          <p className={s.heroDescription}>
            How to delete your RootLens account and associated data.
          </p>
        </div>
      </section>

      {/* Instructions */}
      <section className={s.section}>
        <div className={s.sectionInner}>
          <h2 className={s.sectionTitle}>How to delete your account</h2>
          <p className={s.prose}>
            You can delete your account directly from the RootLens app:
          </p>
          <ol className={d.stepList}>
            <li>Open the RootLens app</li>
            <li>
              Go to <strong>Settings</strong> (tap the gear icon on the Home
              tab)
            </li>
            <li>
              Scroll to the bottom and tap{" "}
              <strong>&quot;Delete account&quot;</strong>
            </li>
            <li>Confirm the deletion when prompted</li>
          </ol>
          <p className={s.prose}>
            Your account and all associated data will be permanently deleted
            immediately.
          </p>

          <h2 className={s.sectionTitle}>What gets deleted</h2>
          <ul className={d.dataList}>
            <li>
              <strong>Account information</strong> — wallet address, display
              name, profile data
            </li>
            <li>
              <strong>Published pages</strong> — all your public pages and their
              links
            </li>
            <li>
              <strong>Stored media</strong> — images and videos in cloud storage
            </li>
          </ul>

          <h2 className={s.sectionTitle}>What cannot be deleted</h2>
          <p className={s.prose}>
            Records on the Solana blockchain (compressed NFTs minted via Title
            Protocol) are immutable and cannot be removed. These records contain
            only cryptographic hashes and verification metadata — no personal
            information or media content.
          </p>

          <h2 className={s.sectionTitle}>
            Can&apos;t access the app?
          </h2>
          <p className={s.prose}>
            If you no longer have access to the app, you can request account
            deletion by emailing{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className={d.link}>
              {CONTACT_EMAIL}
            </a>{" "}
            with the wallet address associated with your account. We will
            process your request within 30 days.
          </p>
        </div>
      </section>
    </div>
  );
}
