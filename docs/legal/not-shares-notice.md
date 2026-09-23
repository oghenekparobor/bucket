> DRAFT — prepared by an engineering assistant for review by qualified counsel. Not legal advice. Not reviewed.

# "Pre-IPO tokens are not shares": confirmation wording

*Spec P0: "A bucket holding pre-IPO tokens states on its confirmation screen that these are not shares: PreStocks are SPV-backed exposure and Tessera tokens are loan participation rights." Placeholders are marked `[[COUNSEL: …]]`.*

## What the design says today

Confirmation sheet:

> This bucket holds pre-IPO tokens ({{b.preTickers}}). They are not shares: PreStocks tokens are SPV-backed exposure and Tessera T-Tokens are loan participation rights. They trade thinly and can sit far from the issuer's mark.

## Why it should change

The issuers' own terms (see `issuer-terms.md`) say more than the design does, and some of it matters to a buyer:

- **PreStocks backing is not only SPVs.** Its terms allow "derivative or synthetic arrangement[s]", other tokens, cash and more, changed without notice, and holders get no claim on any of it.
- **Tessera T-Tokens are unsecured loans** to a Tessera company, repaid only from exit proceeds. "Loan participation rights" is Tessera's phrase; "unsecured loan" is what the terms describe.
- **Neither is approved by the company**, and two companies have publicly called such structures void.
- Both have **deadlines after an exit**; miss them and the token is worthless.

## Proposed wording

### Confirmation screen: one short paragraph

Use the variant that matches what the bucket holds, so the screen never mentions an issuer the bucket does not hold.

**Both issuers:**

> This bucket holds pre-IPO tokens ({{preTickers}}). **They are not shares.** You get no ownership, votes or dividends, and the companies have not approved them. PreStocks tokens track a company through SPVs or other arrangements, with no claim on them. Tessera T-Tokens are unsecured loans, repaid only if the company exits. Both trade thinly and can sit far from the issuer's mark.

**PreStocks only:**

> This bucket holds pre-IPO tokens ({{preTickers}}). **They are not shares.** You get no ownership, votes or dividends, and the companies have not approved them. PreStocks tokens track a company through SPVs or other arrangements, with no claim on them. They trade thinly and can sit far from the issuer's mark.

**Tessera only:**

> This bucket holds pre-IPO tokens ({{preTickers}}). **They are not shares.** You get no ownership, votes or dividends, and the companies have not approved them. Tessera T-Tokens are unsecured loans, repaid only if the company exits. They trade thinly and can sit far from the issuer's mark.

### One-line variant

For the bucket page panel header, builder chips and catalog rows:

> Pre-IPO tokens are not shares: no ownership, no votes, no claim on the company.

### Deadline line (only when a holding has one)

Show under the paragraph when any holding has a conversion or redemption deadline:

> {{ticker}} has a deadline: it must be {{swapped|redeemed}} by {{date}}, or it becomes worthless. [[COUNSEL: add who does this for the vault, e.g. "Bucket will do this for the vault and notify you 24 hours before", only once the process is agreed.]]

Example as of 21 September 2026: SpaceX PreStocks must be swapped before 11:59pm UTC on 12 March 2027.

## Rules for the screen

1. Show it **before** the confirm button, not after. Do not hide it behind a tap.
2. Show it on every route: mint and pool swap alike.
3. Keep "They are not shares." in bold.
4. [[COUNSEL: decide whether the user must tick a box ("I understand pre-IPO tokens are not shares") the first time they invest in such a bucket. A tick adds friction but records acceptance.]]
5. The label "pre-IPO" is no longer accurate for a company that has listed (SpaceX listed in June 2026). [[COUNSEL: product to decide the label, e.g. "private-market token", since the not-shares point still holds after an IPO.]]
