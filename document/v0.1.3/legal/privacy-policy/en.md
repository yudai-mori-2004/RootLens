# Privacy Policy (privacy-policy)

**Type**: User-facing (production, binding) / **Status**: Draft (counsel review before publishing) / **Language**: en (mirror of [ja.md](ja.md), authoritative)

> Important: This is an external legal document and **requires review by qualified counsel before publication** ([`legal-policy`](../legal-policy/en.md) §10). This draft reflects the [`legal-policy`](../legal-policy/en.md) decisions (D1–D8).
>
> The existing public version (`web/components/lp/PrivacyPolicyPage.tsx`) describes the business only as a "content authenticity platform" and omits data sale, licensing, staking, KYC, and third parties, **diverging from the actual business**. This document is the authoritative replacement.

## 0. Presentation (layered)

- **Layer 1 = Summary (§1)**: plain, non-binding, for comprehension.
- **Layer 2 = Full text (§2 onward)**: this document is **authoritative and binding**. If they conflict, the full text prevails.
- Consent/acknowledgement is logged with version + hash via [`consent-log-spec`](../consent-log-spec/en.md).

## 1. Summary (non-binding)

> - **What we collect**: **video** of housework, work tasks, etc. (no audio is recorded), sensor data such as hand motion, device info, and account info.
> - **What we use it for**: building training data to improve AI and robots, and **providing/selling it to outside companies** (including outside Japan).
> - **Privacy processing**: faces etc. are blurred before sharing, but you may not become fully unidentifiable (we do not say "anonymized").
> - **Your rights**: view, correct, delete, and stop (withdraw consent). However, data already used for training cannot be removed from past training.
> - **Recording request**: only you and adults who consented to being recorded may appear; do not record children.
> - **Contact**: contact@rootlens.io
>
> This is a summary. The official content is in the full text below.

## 2. Operator & scope

### 2.1 Operator (personal-data handler / controller)
RootLens ("we"; entity formation in progress; until then the operating individual is the handler). Contact: contact@rootlens.io.
> Audit note: the existing page's contact `contact@titleprotocol.org` is incorrect; this document standardizes on `contact@rootlens.io`.

### 2.2 Scope
All handling of personal data across our app, website, and data-sale service. It concerns not only the recording user but also **people who may be captured** in recordings (addressed in "Third parties, children, private spaces" below).

## 3. Information we collect
- **Video** from the head-mounted camera (no audio is recorded)
- Sensor data per capture configuration (hand pose, IMU, LiDAR, etc.)
- Device/technical info (model, OS, app version, capture settings)
- Account information (account identifiers we issue, login credentials)
- Usage/logs

## 4. Purposes
- **Creating training data** for AI/robots (including quality scoring and content labeling)
- **Licensing/providing/selling** datasets (to outside companies, research institutions, AI companies, including outside Japan)
- Revenue distribution and transaction records
- Detection and handling of fraud and illegal content
- Service provision, improvement, and support

## 5. Third-party provision, sale, sublicensing
- We **license/provide/sell** datasets to outside parties (this is the core of the business).
- Licensing is activated via a **license document** between us and the recipient (the binding terms are in the license document and our Terms of Service).
- Buyers are contractually bound by **no-re-identification, use limitations, and downstream flow-through obligations**.

## 6. Cross-border transfer
Data **may be provided to companies outside Japan**. Recipients and destinations are limited by our internal transfer rules; excluded regions (US all-party-consent states, mainland China, EU, etc., until ready) are not served.

## 7. Privacy processing
- Faces etc. are auto-blurred before sharing, but this is **not full anonymization** (identifiable via body, room, possessions). We do not call it "anonymized."

## 8. Third parties, children, private spaces
- We assume and require that **only the recording user and adults who consented to being recorded appear**.
- **Clips containing a non-consenting third party are not sold** (detection then exclusion).
- **Children, illegal content, and private spaces (bathroom/bedroom/toilet, etc.) are blocked**; detected illegal material is handled and reported as required by law.

## 9. Retention
Retained for as long as necessary for the purposes and as required by law, then deleted or rendered non-distributable (specific periods to be added once fixed).

## 10. Your rights
- You may request access, correction, suspension of use, deletion, and withdrawal of consent.
- **Deletion scope**: data before training use is deleted. **After training use**, it is excluded from future training, but **past training cannot be undone**. We do not promise "complete deletion anytime."
- Requests: contact@rootlens.io

## 11. Withdrawal of consent and its effect
The user may withdraw consent anytime. After withdrawal, we stop new collection/sale and delete un-trained data. Effects on already-issued licenses and trained models are as described in "Your rights" above (the past cannot be undone).

## 12. Security
Because video is sensitive, we apply encryption, access control, and retention management. Breaches are notified per law.

## 13. Children's information
We do not allow children as subjects. The recording user must be 18 or older.

## 14. Applicable regions
We expand availability in stages. Currently Japan-first.

## 15. Amendments
This policy may be amended. Material changes are announced; versions and hashes are managed.

## 16. Contact
contact@rootlens.io

## Change log
| Date | Change |
|------|--------|
| (initial) | Authoritative draft reflecting the real business (data sale, staking, KYC, third parties). Layered structure. Counsel review before publishing |
| (rev 2) | Cleaned internal references (section numbers, internal-doc slugs, D-codes) into plain prose for public output; unified contact to contact@rootlens.io |
| 2026-07-12 | Removed wallet public key, KYC, and blockchain/NFT references (the features were removed from the system in v0.1.4); added account information to the collected-data list |
