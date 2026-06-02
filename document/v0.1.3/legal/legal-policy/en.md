# RootLens Data Protection & Legal Policy

This document fixes the **legal decisions** governing RootLens's data collection and sale. It is independent of the implementation (code): decisions are settled first, and implementation, contracts, and UI flow down from here as derived specifications. It is a Source of Truth on par with `DATA_SPECS_JA.md` (data pipeline) and `UI_SPECS_JA.md` (UX); where they conflict, the legal decisions in this document prevail.

> This is the English mirror of `ja.md`. The Japanese version is authoritative; if the two diverge, follow `ja.md` and reconcile.

## 0. Positioning and disclaimer

- This document records internal decisions and is not final legal advice. The items in §10 are settled only after review by qualified counsel in each major jurisdiction (at minimum EU, US, Japan, China).
- Confidence tags:
  - **[CONFIRMED]** = settled through the analysis so far; changing it requires an affirmative reason.
  - **[RECOMMENDED — APPROVAL PENDING]** = this document's recommendation; promoted to [CONFIRMED] upon the representative's approval.
  - **[COUNSEL REVIEW REQUIRED]** = direction is indicated, but confirmation requires expert review.
- This document addresses *how we bear responsibility* (= documenting Reduce / Transfer / Accept / Demonstrate), not how to make responsibility disappear. The targets of liability and the room to limit them follow §6.

---

## 1. Core principle (the spine)

### 1.1 The basis of legality is "consent"; anonymization is supplementary [CONFIRMED]

The lawful basis for sale rests on the **recorder's explicit consent**. Anonymization processing such as face masking is a **risk-reduction layer** that shrinks the population of incidental third parties — it is not the lawful basis.

Rationale: Because we sell the video itself plus detailed labels for training, utility and identifiability are in tension (the more useful for training, the harder to anonymize). The posture "anonymized, therefore outside the scope of data protection law" (adopted by a comparable operator) is fragile for dense in-home footage: the moment re-identification is shown, past sales become retroactively unlawful. We therefore do not bet on anonymization and make consent the spine.

### 1.2 We are the controller (substance over form) [CONFIRMED]

Form — a P2P appearance, a fee model, not holding KYC data, on-chain attribution of the license — does **not** reduce controller responsibility for the **personal data of the people appearing in the video (the core of the third-party problem)** in any way. Because we determine the purpose of processing (sale for training) and the means (scoring, packaging, marketplace, buyer contracts) and reap economic benefit (fees), we are in substance both controller and seller. This document proceeds on that awareness.

- Distinction: the recorder's KYC identity data (held by the KYC provider, not by us) and the personal data of people appearing in the video content are different things. Minimizing the former is effective, but it does not move responsibility for the latter.
- We do not adopt the argument "we are merely a processor / the recorder is the sole controller" (it fails because we process for our own purposes).

---

## 2. Business decisions (settled items D1–D8)

| ID | Decision | Confidence | Implications (impact on implementation / contracts / UI) |
|----|----------|------------|------|
| **D1** | The lawful basis is **consent-centric**. Anonymization is stated as a supplementary layer. | [CONFIRMED] | A consent log design is mandatory (§9 ★3). |
| **D2** | **Record audio** (following the approach of a comparable operator). Because conversation = the most sensitive data, wiretap-law handling is bundled in as a hard requirement. | [CONFIRMED (APPROVED)] | US all-party-consent states (CA/IL/FL/WA/PA, etc.) require all-party consent to record → add these to the **§8 hard exclusions**. Voiceprint = biometric identifier, so strengthen the §3 "identifiable third party" exclusion and R6. Relatively low risk under the Japan-first phase; a primary issue at worldwide rollout. Detail in §10-8. |
| **D3** | Tier third-party handling by re-identifiability (§3). **Clips containing an identifiable third party are excluded from sale.** | [CONFIRMED] | Requires a path from person detection in the scoring pipeline → exclusion at the sale gate. |
| **D4** | **Children, illegal content, and private spaces (bathroom / bedroom / toilet) are not accepted.** Do not ship the relevant feature until detection-block + a detection-time protocol (§7 / §9 ★7) exist. | [CONFIRMED] | A block, not a "warning." Prepare CSAM-detection preservation and mandatory-reporting procedures first. |
| **D5** | Do **not** label anything "anonymized" in external materials (§5). | [CONFIRMED] | Apply the terminology discipline across LP, dataset descriptions, policies, and buyer contracts. |
| **D6** | **Honestly disclose** the scope of what we promise users on deletion / withdrawal: full deletion before training, exclusion from future training thereafter. | [CONFIRMED] | State this in the privacy policy and terms. Do not overstate as "delete anytime, completely." |
| **D7** | **The ultimate goal is worldwide**, but via **phased rollout**, with the realistic initial scope being **Japan**. Biometric-regulation states (e.g., BIPA), all-party-consent states, mainland China, and (until the apparatus is ready) the EU/EEA are excluded or in strict mode until each jurisdiction's apparatus is ready. | [CONFIRMED (APPROVED)] | Connect origin × destination gating to KYC (§8). Design the architecture for worldwide, but open up jurisdiction by jurisdiction in stages. |
| **D8** | Residual risk is **recorded in the register and accepted by the representative**. Take out **data / cyber liability insurance**. | [RECOMMENDED — APPROVAL PENDING] | Register operation per §7 + arranging insurance. |

> D2, D7, D8 are this document's default recommendations. They are promoted to [CONFIRMED] upon approval. Record approvals in the "Revision history" section.

---

## 3. Classification and handling tiers for data and data subjects [CONFIRMED]

Classify the subjects who may appear in footage by re-identifiability and fix their handling. Run this tier determination before a clip reaches the sale gate (stake → license).

| Subject | Example | Lawful basis | Handling |
|---------|---------|--------------|----------|
| **The recorder** | App user | Explicit consent (at stake time) | **Saleable** after preview + the recorder's approval |
| **Incidental third party** (few other means of identification) | A delivery person or passerby seen briefly | Anonymization (supplementary layer) | Face/identifier masking to render non-re-identifiable → **saleable** |
| **Identifiable third party** (continuous / identifiable from context) | A cohabiting family member, a regular visitor | Cannot be obtained | Detect → **exclude that clip from sale** (no consent and no reliable anonymization) |
| **Child / illegal / private space** | Children, nudity, bathroom, etc. | Cannot be legalized by consent | Detect → **block + detection-time protocol** (§7) |
| **Sensitive information** (objects / environment) | Religious items, medicine, documents, screens | Recorder consent + masking | Saleable after masking sensitive objects. Accept incompleteness as residual risk (§7) |

Principle: **Anything that has neither consent nor reliable anonymization must not reach the sale path.** Masking is insurance for the "incidental" portion; it is not used for identifiable third parties or children.

---

## 4. Re-identification threshold (the bar we impose on ourselves) [RECOMMENDED — APPROVAL PENDING]

Define, as an internal standard, the conditions under which "anonymization (supplementary layer)" is treated as achieved.

1. Personally identifying information in faces, audio (where recorded), on-screen displays, and documents/IDs is masked or removed.
2. From the remaining footage, an internal re-identification test does not lead to identification of the subject.
3. Anyone who does not meet the above, or who appears continuously (family, etc.), is not treated as "anonymized" and is excluded per §3.

Record the method, frequency, and results of the re-identification test (§6 ④ Demonstrate). The default behavior when the bar is not met is "exclude from sale" (fail-safe).

---

## 5. Terminology discipline [CONFIRMED]

| Do not use | Use instead |
|------------|-------------|
| anonymized / 匿名化済み | face-masked / de-identified / identifier-removed |
| outside the scope (of data protection law) | (do not use; state consent as the basis) |
| delete anytime, completely | deletable before training; excluded from future training thereafter |

Rationale: Overstating "anonymized" creates a double problem: (a) misrepresentation risk toward users and buyers, and (b) the risk of unlawful processing by neglecting obligations after wrongly believing "we're out of scope, so no obligations." Apply this across all external materials (LP / dataset descriptions / policies / buyer contracts). Also keep the existing rule of not mixing internal design process into public-facing text.

---

## 6. How we bear responsibility (four actions and the room to limit) [CONFIRMED]

"Bearing responsibility" is defined as **documenting, in advance**, the following four actions.

| Action | Concretely | Corresponding document |
|--------|-----------|------------------------|
| **① Reduce** | Masking, detect→exclude, space exclusion, access control, retention period | §3, §4, DATA_SPECS |
| **② Transfer** | Insurance, no-re-identification / liability caps in buyer contracts, recourse against the recorder | §9 ★8 / ★6 |
| **③ Accept** | The representative accepts and records the residual risk that cannot be eliminated | §7 |
| **④ Demonstrate** | Document ①–③ in advance and keep evidence (accountability principle) | This whole document + the register |

**④ is the most important.** For the same violation, the outcomes of "no records = negligent unlawful processing (heavy, deemed egregious)" versus "records of measures + residual-risk acceptance = reasonable measures taken (mitigated, defensible)" differ greatly.

**The realistic room to cap liability:**

| Target | Can it be capped? | Means |
|--------|-------------------|-------|
| Regulator (fines) | **No** (we bear it as controller) | ① Reduce is primary, insurance secondary |
| The third party's statutory rights | **No** (not bound by our contract) | ① Reduce (prevent occurrence) |
| Criminal liability | **No** (attaches to individuals, non-transferable) | ① Reduce (D4) |
| Buyer (B2B) | Yes | Liability caps / no re-identification by contract |
| Recorder (consumer) | Partially | Recourse clause (recovery is practically limited and constrained by consumer law) |

Conclusion: contracts are the last thin layer. The core is **① Reduce (do not let anything without consent or anonymization reach sale).**

---

## 7. Residual risk register (operational template)

Record **measures / residual / acceptance decision / acceptor / date** on each row. For rows that are not accepted, do not ship the relevant feature until the implementation is solid.

| # | Risk | Measures taken (① Reduce) | Residual risk | Acceptance decision | Acceptor / date | Transfer (②) |
|---|------|---------------------------|---------------|---------------------|-----------------|--------------|
| R1 | An incidental third party appears | On-device face/identifier masking | Room for re-identification via voice / body / context | Accept | (rep / date) | Insurance |
| R2 | An identifiable family member, etc. appears | Person detection → exclude that clip from sale (D3) | Missed detection | Accept (record residual rate) | (rep / date) | Insurance + recourse |
| R3 | Children / illegal / private space | Detection-block + space exclusion + detection-time protocol (D4) | Missed detection | **Do not accept** (zero-oriented) | — | — |
| R4 | Sensitive info (religion / medicine / documents / screens) | Masking sensitive objects | Masking is not complete | Accept | (rep / date) | Insurance |
| R5 | Right to erasure vs. trained model | Pre-training deletion guarantee + buyer downstream obligations + honest disclosure (D6) | After training, only exclusion from future training | Accept + disclose | (rep / date) | Contract |
| R6 | Audio/conversation sensitivity / wiretap law / voiceprint | Audio recorded (D2). All-party-consent states hard-excluded in §8; voiceprint counted as an identifier in the §3 exclusion test | Exclusion gaps / re-identification by voice | Accept (conditional on handling). Low risk Japan-first; re-evaluate at worldwide rollout | (rep / date) | Insurance + contract |
| R7 | Cross-border / prohibited destinations | Origin × destination gating (D7) | Configuration gaps | Accept (exclude relevant regions until built out) | (rep / date) | Contract |

The detection-time protocol (R3) is separately documented as a runbook: detect → immediate block → handling (preservation) of the detected material → mandatory reporting for CSAM, etc. (§9 ★7). "Just stopping" is insufficient (the act of detection itself can create a possession problem).

---

## 8. Jurisdiction scope [RECOMMENDED — APPROVAL PENDING]

Do not offer everywhere simultaneously. Control paths by origin (recorder location) × destination (buyer location).

| Jurisdiction | Initial policy | Reason |
|--------------|----------------|--------|
| Japan | **First** (deploy on the premise of the consent design) | APPI third-party provision can be handled with opt-in consent; consistent with our consent design |
| US biometric-regulation states (IL/TX/WA, etc.) | **Exclude** (until the apparatus is ready) | Class-action risk from private rights of action / statutory damages under BIPA, etc. |
| US all-party-consent states (CA/IL/FL/WA/PA/MD/MA, etc.) | **Exclude** (because D2 = recording audio) | Recording requires all-party consent; recording in-home family conversation can be a criminal risk |
| Mainland China | **Exclude** | Sale of personal information can be criminal (PIPL + Criminal Law Art. 253) |
| EU/EEA | **Strict mode or deferred** | Controller obligations / erasure rights / cross-border are heavy; deploy after the apparatus is complete |
| Transfers to countries of concern (China, Russia, etc.) | **Block** | US bulk sensitive-data transfer rules (for data of the relevant origin) |

Connect KYC (buyer identity verification) to destination gating and block prohibited paths in the system.

---

## 9. Required document set (deliverables list)

★ = priority (core of consent design / responsibility evidence) / ☆ = follow-on (build out with counsel).

| # | Document | Contents | Type | Status |
|---|----------|----------|------|--------|
| ★1 | **This document (Data Protection & Anonymization Policy)** | The decisions in §1–§8 | Internal | Draft |
| ★2 | **Residual risk register** | §7 | Internal | Template fixed, acceptance pending |
| ★3 | Consent log design | Tamper-evident record of who / when / for which clip / consented to what (sale / cross-border / sensitive) | Spec | Not started |
| ★4 | DPIA (Data Protection Impact Assessment) | Risk assessment for large-scale / sensitive / in-home monitoring | Internal | Not started |
| ★5 | Privacy policy (external) | Collection / who it's sold to / retention / rights / the honest limits of deletion (D6) | To users | Not started |
| ★6 | Terms of Service + recorder data license agreement | Representations & warranties (no third parties in frame) / recourse / deletion limits / nature of consideration | To users | Not started |
| ★7 | Incident response runbook | Re-identification discovered / missed third party / mandatory reporting on CSAM detection / breach | Internal | Not started |
| ☆8 | Buyer license agreement | No re-identification / use restrictions / downstream deletion obligations / resale restrictions | To buyers | Not started |
| ☆9 | Processor agreement (DPA) | KYC provider, Modal, etc. | To vendors | Not started |
| ☆10 | Cross-border transfer arrangements | SCCs / destination gating (D7 / §8) | Later | Not started |
| ☆11 | Records of Processing Activities (RoPA) | A register listing processing | Internal | Not started |

---

## 10. Items requiring counsel review / open issues [COUNSEL REVIEW REQUIRED]

Direction is indicated, but confirmation requires expert review.

1. **Securities nature of staking**: ensure the economic substance is "consideration for providing data" via contract wording and token design (do not lean toward an investment contract = Howey). Also assess MiCA / money transmission.
2. **Stablecoin payments**: regulatory fit under EU MiCA (EMT/ART), US money transmission / stablecoin legislation, and the chosen currency.
3. **Payments to recorders and worker classification**: avoid gig-classification risk (do not impose direction/control or exclusivity); taxation / withholding / consumption tax.
4. **Cross-border transfer procedures**: SCCs / adequacy / DPF, and the cross-border rules of each origin.
5. **Biometric-regulation states / China**: sufficiency of the exclusion design (§8) and conditions for lifting it.
6. **Validity of consent**: wording that moves off reliance on a blanket first-launch ToS consent and integrates explicit consent for sale / cross-border / sensitive information into the stake-time consent.
7. **Consumer contracts**: enforceable scope of recourse / liability-limitation clauses (unfair-terms rules / Consumer Contract Act).
8. **Wiretap-law handling for audio recording (D2)**: at worldwide rollout, how to obtain recording consent in US all-party-consent states (CA/IL/FL/WA/PA/MD/MA, etc.), whether voiceprints fall under biometric regulation (BIPA, etc.), and handling of the sensitivity of conversation content. Also includes final confirmation of whether recording is permissible during the Japan-first phase.

---

## Revision history

| Date | Change | Confirmed / approved |
|------|--------|----------------------|
| (initial) | Drafted §0–§10. Filed D1, D3, D4, D5, D6 as [CONFIRMED]; D2, D7, D8 as [RECOMMENDED — APPROVAL PENDING] | Awaiting approval: D2, D7, D8 |
| (approval 1) | D2 = **record audio** (all-party-consent states hard-excluded in §8, voiceprint added to §3 exclusion test, §10-8 added). D7 = confirmed as **worldwide goal / Japan-first phased rollout**. Both promoted to [CONFIRMED (APPROVED)] | D2, D7 confirmed. **D8 deferred (left blank)** |
