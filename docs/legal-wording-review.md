# Legal wording review — 0.6.1 generated-policy sections

**This is draft, starting-point wording — not finalized or attorney-approved language.** It was written to be neutral and minimal, and to never assert a fact the user didn't actually provide (see the placeholder mechanism at the bottom), but it has not been reviewed by counsel. Review and revise before any generated policy is published, especially the three sections marked **HIGH PRIORITY** below.

Every sentence below is reproduced verbatim from [`src/policy/generatePolicy.ts`](../src/policy/generatePolicy.ts). `{field}` marks where a user-supplied value is substituted in. Every field can also render as a literal `[TO COMPLETE: ...]` placeholder instead — the exact placeholder text is given for each.

---

## 1. ⚠️ HIGH PRIORITY — Sell/Share & Advertising

Section: `## Data Retention, Deletion, and Use` (two of its sentences, plus a shared closing line).

These are the highest-risk sentences in the document: the policy can simultaneously list detected third-party integrations (e.g. Stripe) in the separate `## Third-Party Data Processors` section (auto-detected from imports, not from these questions). To avoid the document implying two contradictory things in two places, every state below ends with the same cross-reference sentence, and the wording is tied to CCPA/CPRA's own defined terms rather than casual language.

**Sell or share personal data** (config: `sellsOrSharesData`, true / false / unanswered):
- **True**: `Based on information provided during setup, this product has been declared to sell or share personal data with third parties, as "sell" and "share" are defined under applicable law (e.g. CCPA/CPRA).`
- **False**: `Based on information provided during setup, this product has not been declared to sell or share personal data with third parties, as "sell" and "share" are defined under applicable law (e.g. CCPA/CPRA).`
- **Unanswered**: `[TO COMPLETE: whether personal data is sold or shared with third parties, as "sell" and "share" are defined under applicable law (e.g. CCPA/CPRA)]`

**Use personal data for advertising** (config: `usesDataForAdvertising`, true / false / unanswered):
- **True**: `Based on information provided during setup, this product has been declared to use personal data for cross-context behavioral advertising.`
- **False**: `Based on information provided during setup, this product has not been declared to use personal data for cross-context behavioral advertising.`
- **Unanswered**: `[TO COMPLETE: whether personal data is used for cross-context behavioral advertising]`

**Closing cross-reference** (always rendered, regardless of either answer's state):
> `See the Third-Party Data Processors section above for the specific third-party integrations detected in this codebase; the declarations above describe this product's own stated practices and do not override what was actually detected there.`

---

## 2. ⚠️ HIGH PRIORITY — Your Rights

Section: `## Your Rights`. Two independent regional declarations (config: `hasEuUkUsers`, `hasCaliforniaUsers`), each true / false / unanswered — four meaningful combinations plus the special "both false" case.

**EU/UK** (`hasEuUkUsers`):
- **True**: `If you are located in the EU or UK, you may have rights under the GDPR and/or UK GDPR, including the right to access, correct, delete, or restrict the use of your personal data.`
- **False**: omitted entirely — not rendered as a sentence at all.
- **Unanswered**: `[TO COMPLETE: whether this product has users in the EU/UK, which determines whether GDPR/UK GDPR disclosures apply]`

**California** (`hasCaliforniaUsers`):
- **True**: `If you are a California resident, you may have rights under the CCPA/CPRA, including the right to know, delete, correct, and opt out of the sale or sharing of your personal data.`
- **False**: omitted entirely.
- **Unanswered**: `[TO COMPLETE: whether this product has users in California, which determines whether CCPA/CPRA disclosures apply]`

**Special case — both explicitly false** (replaces both lines above with one neutral line, instead of an empty-looking section):
> `This product has not declared users in jurisdictions with additional statutory privacy rights (EU/UK, California).`

---

## 3. ⚠️ HIGH PRIORITY — Children's Privacy

Section: `## Children's Privacy`. Two facts: `collectsChildrensData` (true / false / unanswered) and `minimumAge` (present / absent).

**Knowingly collects children's data** (config: `collectsChildrensData`):
- **True**: `This product knowingly collects personal data from children under applicable age thresholds (e.g. under 13 in the US, under 16 in the EU where applicable).`
- **False**: `This product does not knowingly collect personal data from children under applicable age thresholds.`
- **Unanswered** — the key is absent from `.srclawyer.config.yml` (a pre-0.6.1 file, or a hand-edited one), or `init`'s question for it was skipped (a bare Enter, empty stdin, or `--no-policy-details`/declining the gate with no `--collects-childrens-data`/`--no-collects-childrens-data` flag): `[TO COMPLETE: whether this product knowingly collects personal data from children]` — deliberately **not** rendered as "no." This question requires an explicit y/n; there is no default. Only an explicit true/false answer (interactive or via flag) ever produces the "yes"/"no" sentences above.

**Minimum age** (config: `minimumAge`):
- **Present**: `Users must be at least {minimumAge} years old to use this product.`
- **Absent**: `[TO COMPLETE: minimum age required to use this product, if any]`

---

## 4. About This Policy

Section: `## About This Policy`. Three independent fields, each a plain sentence or a placeholder.

- **Company or product name** (`companyName`): `This policy is issued by {companyName}.` / `[TO COMPLETE: company or product name]`
- **Site or app URL** (`siteUrl`): `It applies to the product or service available at {siteUrl}.` / `[TO COMPLETE: site or app URL]`
- **Privacy contact email** (`privacyContactEmail`): `Questions about this policy or requests regarding your personal data can be sent to {privacyContactEmail}.` / `[TO COMPLETE: privacy contact email address]`

---

## 5. Data Retention, Deletion, and AI-services use

Section: `## Data Retention, Deletion, and Use` (remaining sentences not covered in section 1 above).

- **Retention** (`dataRetentionPolicy`): `Personal data is retained as follows: {dataRetentionPolicy}` / `[TO COMPLETE: data retention period or policy]`
- **Deletion** (`accountDeletionInstructions`): `To delete your account or request deletion of your personal data: {accountDeletionInstructions}` / `[TO COMPLETE: how a user can delete their account or request data deletion]`
- **AI services** (`sendsDataToAiServices` — about this product's own behavior, never about SrcLawyer's own tooling):
  - **True**: `User data may be sent to third-party AI services as part of this product's own functionality.`
  - **False**: `User data is not sent to third-party AI services as part of this product's own functionality.`
  - **Unanswered**: `[TO COMPLETE: whether user data is sent to third-party AI services as part of this product's own functionality]`

---

## 6. Placeholder-summary mechanics

No fixed sentence text — this is a generated list, not prose. If one or more of the fields above was left unanswered, the document renders, right after any scan-level warning banners and before the "Generated by SrcLawyer" line (i.e. at the very top of the document):

```
## Placeholders — Complete Before Publishing

- [TO COMPLETE: <label>]
- [TO COMPLETE: <label>]
...
```

one bullet per unique unanswered field, using the exact same `[TO COMPLETE: ...]` text that appears inline at that field's actual section. If every field above was answered, this section is omitted entirely — it never appears empty. No date or "last updated" field is included anywhere in the document; none is auto-populated from scan time.
