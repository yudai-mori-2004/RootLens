# Tester Consent + Recording Rules (tester-consent)

**Type**: User-facing (lightweight) / **Status**: Draft / **Language**: en (mirror of [ja.md](ja.md), which is authoritative)

A lightweight consent document for the alpha (TestFlight) stage. Until the production [`privacy-policy`](../privacy-policy/en.md) and [`terms-of-service`](../terms-of-service/en.md) are ready, it obtains the **recording user's explicit consent to "collect, use, and license/sell to third parties"** so that alpha-collected data remains lawfully usable later. It operationalizes the [`legal-policy`](../legal-policy/en.md) decisions (D1/D2/D3/D4/D5/D6) in minimal form.

## 0. Presentation method (layered consent)

Consent is presented in **two layers**.

- **Layer 1 = Summary (§2)**: Plain wording even non-experts understand. **It is not itself binding.** Its purpose is comprehension.
- **Layer 2 = Tester Terms, authoritative (§3)**: The **binding full text** that is the actual object of consent. The full text must be readable in-app at any time.
- Pressing "Agree and start" means the user consents to the **full text of §3**. If the summary (§2) and the authoritative text (§3) conflict, **§3 prevails**.
- On consent, record the **version and hash of the §3 text consented to, and the version and hash of the §2 summary shown** (see [`consent-log-spec`](../consent-log-spec/en.md)).

> Copy principle: Informed consent requires comprehension, so Layer 1 is kept strictly plain and **free of jargon (stake/NFT, etc.)**. Legal completeness is carried by Layer 2.

## 1. Scope

- All alpha / TestFlight testers.
- **Premise that only the recording user appears** (§3.4). This consent covers only the recording user's own data and does not substitute for any third party's consent.

## 2. Layer 1 — On-screen summary (non-binding)

The implementation displays this summary and must allow navigation to the **full §3 text ("Read the terms") from the same screen**.

> **Before you start, please confirm** (This is a plain-language **summary**. The official content is in the "Tester Terms"; pressing "Agree and start" means you agree to the official content.)
>
> - This app records **video and audio** of you doing housework etc., via a head-mounted camera.
> - The data is used to train AI and home robots, and for that purpose **may be provided or sold to outside companies** (including companies outside Japan).
> - Faces and similar details are auto-blurred before sharing, but **this may not make you fully unidentifiable**.
> - So please **record only when you are alone**.
> - You can stop anytime. Data not yet used for training can be deleted. **Data already used for training can be excluded from future training, but past training cannot be undone.**
>
> ☐ I am 18 or older and have the right to record in this place
> ☐ I agree not to record other people or children
> ☐ **I have read and agree to the Tester Terms (full text)** (including provision/sale to outside companies and transfer outside Japan)
>
> **[Agree and start]**　**[Read the terms (full)]**

## 3. Layer 2 — Tester Terms (authoritative, binding)

This is the official document that is the object of consent. Make the full text accessible in-app; on consent, record this version + hash (§4).

### 3.1 What is recorded
**Video and audio** from the head-mounted camera; depending on capture configuration, sensor data such as hand pose; technical info such as model, OS, and app version.

### 3.2 Use
Creation of AI/robot training data. For that purpose, **licensing, provision, or sale to outside companies, research institutions, and AI companies (including outside Japan)** may occur.

### 3.3 Privacy processing (no overstatement)
Faces etc. are auto-blurred before sharing. However, **it is not fully anonymized** (one may be identifiable from voice, body, or room). We do not call this data "anonymized" (D5). Because audio is recorded, **voice is also treated as information that can identify a person** (D2).

### 3.4 User obligations and warranties (= recording rules)
The user must comply with, and warrants that each provided clip satisfies, the following.
- **Record only when alone.** Do not record when others (family, guests, friends) are present.
- **Do not record children.** Stop if a child enters.
- **Do not record bathrooms, bedrooms, toilets, or changing.**
- **Do not release (sell)** any clip that accidentally captured another person or a child.
- Avoid scenes where TV, music, books, or others' works appear prominently.
- That provided clips contain no third-party rights (likeness, publicity, copyright, etc.).

### 3.5 Withdrawal & deletion (honest scope / D6)
You may stop recording anytime. Data **before** it is used for training can be deleted. **After** it is used for training, it can be excluded from future training, but **past training cannot be undone**. We do not promise "complete deletion anytime."

### 3.6 Third parties
A clip containing a third party is **not placed on the sales path** even with the user's consent (detection → exclusion; [`legal-policy`](../legal-policy/en.md) §3). The "do not record" rule here is a first-line defense, not a substitute for detection → exclusion/blocking.

### 3.7 Object of consent
The object of consent is the **full text of this §3**. The §2 summary is merely an aid to understanding and, where it conflicts with this §3, this §3 prevails.

### 3.8 Scope & regions
These terms are the lightweight alpha version. They are not used to launch in regions excluded/strict under [`legal-policy`](../legal-policy/en.md) §8 (US all-party-consent states, mainland China, EU, etc.).

## 4. Consent metadata to log (see [`consent-log-spec`](../consent-log-spec/en.md))

On consent, record at least the following in a tamper-resistant form.
- Tester identifier (wallet public key / user ID)
- Consent timestamp (UTC)
- **Version and hash of the §3 consented to**, and **version and hash of the §2 summary shown**
- Scope consented (collection / AI-training use / third-party licensing & sale / cross-border transfer)
- Results of the three checkboxes
- App/device info

## 5. Limits & assumptions

- This is the **lightweight alpha version**, replaced in production by [`privacy-policy`](../privacy-policy/en.md) + [`terms-of-service`](../terms-of-service/en.md).
- Clips containing third parties are not placed on the sales path (§3.6).
- Data collected before this consent is, in principle, test-only and not for sale.

## Change log

| Date | Change |
|------|--------|
| (initial) | Created for alpha / TestFlight. Reflects D1/D2/D3/D4/D5/D6 |
| (rev 2) | Restructured to layered consent (non-binding summary + authoritative full text + binding = full text + version/hash logging) |
