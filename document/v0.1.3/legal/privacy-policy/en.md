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

> - **What we collect**: **video** of housework and work tasks (no audio is recorded), sensor data such as hand motion, device info, account info, and the information needed to pay filming fees.
> - **What we use it for**: building training data for AI and robots and **providing/selling it to companies in and outside Japan**. Revenue funds the filming fees paid to the cooperating sites and staff.
> - **Privacy processing**: faces etc. are blurred before sharing, but you may not become fully unidentifiable (we do not say "anonymized").
> - **Your rights**: you may request disclosure, correction, deletion, suspension of use, and withdrawal of consent. However, data already used for training cannot be removed from past training.
> - **Recording rules**: only the recording user and adults who consented to being recorded may appear; do not record children.
> - **Contact**: contact@rootlens.io
>
> This is a summary. The official content is in the full text below.

## 2. Operator & scope

### 2.1 Operator (personal-data handler / controller)
RootLens ("we"; entity formation in progress; until then the operating individual is the handler). Contact: contact@rootlens.io. The operator's name and address are provided without delay upon request.
> Audit note: the existing page's contact `contact@titleprotocol.org` is incorrect; this document standardizes on `contact@rootlens.io`.

### 2.2 Scope
This policy applies to the handling of personal data across our app, website, and data-sale service. It concerns not only the recording user but also representatives of cooperating businesses and **people who may be captured** in recordings (see "9. Third parties, children, private spaces").

## 3. Information we collect
- **Video** from the head-mounted camera (no audio is recorded)
- Sensor data per capture configuration (hand pose, IMU, LiDAR, etc.)
- Device/technical info (model, OS, app version, capture settings)
- Account information (account identifiers we issue, login credentials)
- Information needed to pay filming fees (bank account details, payment records)
- Names and contact details of representatives of cooperating businesses
- Information you provide with inquiries or requests (including identity verification)
- Usage/logs

## 4. Purposes

We use the information we collect for the following purposes, according to whose information it is.

**Recording staff (the person filming)**
1. Creating training data for AI/robots (including reviewing video and sensor data, blurring faces, labeling content, and quality management)
2. Licensing/providing/selling the resulting datasets to companies and research institutions in and outside Japan
3. Paying filming fees, and the identity verification, bank-account management, and payment record-keeping this requires (including tax and other statutory record obligations)
4. Managing accounts and confirming the user is 18 or older
5. Confirming that recording follows this policy and the recording rules (including reviewing every clip before delivery)
6. Keeping and managing records of the consent given

**Representatives of cooperating businesses (stores, etc.)**
7. Communication about the filming cooperation, contract management, and paying and recording the filming fees

**People who appear in recordings**
8. Blurring faces and reviewing clips to exclude any in which a non-consenting person is identifiable
9. Handling inquiries and requests (suspension of use, deletion) about appearing in footage

**Everyone**
10. Detecting and handling fraud and illegal content
11. Responding to inquiries and to disclosure/correction/deletion requests (including identity verification)
12. Providing, maintaining, and improving the service
13. Complying with legal obligations

## 5. Third-party provision, sale, sublicensing
- We **license/provide/sell** datasets to outside parties (this is the core of the business).
- Licensing is activated via a **license document** between us and the recipient (the binding terms are in the license document and our Terms of Service).
- Buyers are contractually bound by **no-re-identification, use limitations, and downstream flow-through obligations**.

## 6. Entrusting data handling
We may entrust all or part of the handling of personal data to outside providers within the scope needed for the purposes above (cloud storage and processing, face blurring, content labeling, etc.). We select providers appropriately, conclude contracts containing data-protection clauses, and supervise them as necessary and appropriate.

## 7. Provision to third parties outside Japan
Data **may be provided to companies outside Japan**. Recipients are limited to parties contractually bound by no-re-identification, use limitations, and downstream flow-through obligations.

## 8. Privacy processing
Faces etc. are auto-blurred before sharing, but this is **not full anonymization** (identifiable via body, room, possessions). We do not call it "anonymized."

## 9. Third parties, children, private spaces
- We assume and require that **only the recording user and adults who consented to being recorded appear**, and limit recording to tasks where customers and other bystanders stay out of frame.
- Recording takes place under a prior agreement with the cooperating business and within the scope agreed with it. We do not record places or scenes the business does not want recorded, and we stop immediately when asked.
- **Incidental, momentary captures** that still occur (someone passing by) are **face-blurred before delivery**. Clips in which a non-consenting person remains **identifiable are not delivered**.
- Every clip is **reviewed one by one before delivery**; clips containing children, illegal content, or private spaces (bathroom/bedroom/toilet, locker or break rooms, etc.) are excluded and deleted. Confirmed illegal material is handled and reported as required by law.

### 9.1 If you may appear in a recording
You may request review, suspension of use, or deletion of footage you may appear in. Requests: contact@rootlens.io (please tell us the location and date).

## 10. Retention
- Recorded video and sensor data (unprocessed): retained for as long as needed to build and quality-check the datasets, then deleted.
- Payment and transaction records: retained as required by tax and other laws (in principle, seven years).
- Consent records: retained while the related data is handled, to preserve accountability.
- After the retention period, information is deleted or rendered unidentifiable.

## 11. Your rights
- You may request disclosure (including disclosure of third-party provision records), correction, suspension of use, deletion, and withdrawal of consent.
- **Deletion scope**: data before training use is deleted. **After training use**, it is excluded from future training, but **past training cannot be undone**. We do not promise "complete deletion anytime."
- Requests are accepted by email and handled within the statutory period after identity verification. No fee is charged (actual costs, such as postage, may apply if you request them).
- Requests: contact@rootlens.io

## 12. Withdrawal of consent and its effect
The user may withdraw consent anytime. After withdrawal, we stop new collection/sale and delete un-trained data. Effects on already-issued licenses and trained models are as described in "11. Your rights" above (the past cannot be undone).

## 13. Security measures
To prevent leakage, loss, or damage of personal data, we take the following measures.

- **Policies and rules**: we define and follow this policy and internal handling rules.
- **Organizational measures**: we designate a person responsible, limit who handles data and with what authority, and record handling status.
- **Personnel measures**: recording staff and data handlers are trained on the recording rules and data protection.
- **Physical measures**: recording devices and storage media are managed for transport and storage.
- **Technical measures**: encryption in transit and at rest, access control, and least-privilege access.
- **External environment**: personal data is stored and processed on servers of cloud providers in the United States. We implement the above measures with an understanding of the data-protection framework of the United States.

Breaches are reported to the Personal Information Protection Commission and notified to the persons concerned as required by law.

## 14. Children's information
We do not allow children as subjects. The recording user must be 18 or older.

## 15. Applicable regions
We expand availability in stages. Currently Japan-first.

## 16. Amendments
This policy may be amended. Amendments are announced by posting on this website, and material changes are additionally notified individually to account holders. The amended policy takes effect on the date stated when posted. Versions and contents of amendments are managed together with consent records.

## 17. Contact
contact@rootlens.io

## Change log
| Date | Change |
|------|--------|
| (initial) | Authoritative draft reflecting the real business (data sale, staking, KYC, third parties). Layered structure. Counsel review before publishing |
| (rev 2) | Cleaned internal references (section numbers, internal-doc slugs, D-codes) into plain prose for public output; unified contact to contact@rootlens.io |
| 2026-07-12 | Removed wallet public key, KYC, and blockchain/NFT references (the features were removed from the system in v0.1.4); added account information to the collected-data list |
| 2026-07-12 (2) | Revised for the closed on-site operation: section 8 states the out-of-frame task limitation and the handling of incidental captures (blur, exclude if identifiable), with a new 8.1 for people who may appear; section 6 drops the audio-era state exclusion list in favor of recipient country (US) and contractual criteria; operator name/address on request, request procedure, and foreign cloud storage added; detection/blocking wording aligned to the per-clip manual review |
| 2026-07-12 (3) | Japanese original rewritten in the standard register of published Japanese privacy policies (desu/masu style, conventional headings); no change to the substance. English mirror unaffected |
| 2026-07-12 (4) | Expanded based on a benchmark against comparable services (Shift, Project Aria) and Japanese data businesses (Macromill, Agoop): purposes rewritten per data subject (naming who filming fees are paid to), collected-data list extended (payment, business representatives, requests), new entrustment section (later sections renumbered), on-site notice and in-site consent confirmation plus locker/break rooms added, retention specified per category, third-party provision records and fees added to requests, security measures published per category including the external environment, and the amendment notice method stated |
| 2026-07-12 (5) | Withdrew the on-site notice and prior coworker-consent-confirmation promises in section 9 (obligations that do not exist in the actual operation or the filming cooperation agreement); replaced with wording matching the agreement (recording within the agreed scope, no recording where the business objects, immediate stop on request) |
| 2026-07-12 (6) | Removed "currently, the main recipients are located in the United States" from section 7 (not factual) |
