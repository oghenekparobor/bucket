> DRAFT — prepared by an engineering assistant for review by qualified counsel. Not legal advice. Not reviewed.

# Geo-restrictions

Checklist item 0.2: *Collect each issuer's restricted-country list and draft Bucket's geo-restriction list from the strictest of them.* Spec open question: *Do buckets that hold [PreStocks and Tessera tokens] need tighter geo-restrictions than xStocks-only buckets?*

**Short answer: yes.** PreStocks and Tessera restrict 26 jurisdictions that xStocks does not (two of them, Hong Kong and Macau, on an uncertain reading), including Singapore, mainland China, all of Ukraine, Bulgaria, Monaco, Kenya and Vietnam. So Bucket needs two tiers.

All sources were fetched on **21 September 2026**. The quotes behind each list are in `issuer-terms.md`.

## How the lists are built

- **Strictest-of.** If any issuer restricts a jurisdiction, Bucket blocks it for every bucket that can hold that issuer's tokens. Every restriction category counts, including Backed's "Non-Serviceable Countries" (which may only cover Backed's own services) and Tessera's FATF grey-list reference.
- **Two tiers.**
  - `blockAll`: blocked from investing in any bucket. This is xStocks' list plus OFAC country-wide programs. Any bucket can hold xStocks, so this is the floor.
  - `blockPreIpo`: blocked from investing in a bucket that holds any PreStocks or Tessera token. **This list is complete on its own**: it already contains every `blockAll` code, so the backend applies one list per bucket, not two.
- **What "blocked" should mean in the app** (for counsel to confirm): no mint, no pool swap through the app, no bucket creation. Viewing public pages stays open. **Exit (redeem or sell) stays open for everyone**, because the spec promises redeem at any time, and trapping funds of someone who moved country would be worse than letting them leave.
- **Uncertain entries are included**, and marked. Removing an entry is counsel's call.

## Per-country table

Legend: ¹ U.S. territories: Backed's U.S. restriction uses Regulation S, whose "United States" includes territories and possessions; Tessera names "territories and possessions" expressly. ² Backed: "NOT available for UK Clients … Certain products will only be available to UK professional clients subject to prior validation". ³ Swiss FinSA: xStocks "may be offered exclusively to professional investors"; blocked because Bucket cannot verify professional status. ⁴ Tessera excludes "the People's Republic of China" without defining it; whether that covers Hong Kong and Macau is uncertain; blocked for pre-IPO buckets until counsel decides. ⁵ See the OFAC section.

| Country | ISO | xStocks (Backed) | PreStocks | Tessera | OFAC | Bucket blocks for |
| --- | --- | --- | --- | --- | --- | --- |
| Afghanistan | AF | [Non-serviceable][xa] | [Prohibited][ps] |  |  | **All buckets** |
| Albania | AL |  | [Prohibited][ps] |  |  | Pre-IPO buckets |
| American Samoa | AS | [U.S. (Reg S)][xc] ¹ |  | [Excluded (U.S. territory)][ts] |  | **All buckets** |
| Angola | AO |  |  | [FATF grey][fatf] |  | Pre-IPO buckets |
| Belarus | BY | [Non-serviceable][xa] | [Prohibited][ps] | [Excluded][ts] |  | **All buckets** |
| Bolivia | BO |  |  | [FATF grey][fatf] |  | Pre-IPO buckets |
| Bosnia and Herzegovina | BA |  | [Prohibited][ps] | [FATF grey][fatf] |  | Pre-IPO buckets |
| British Virgin Islands | VG |  | [Prohibited][ps] | [FATF grey][fatf] |  | Pre-IPO buckets |
| Bulgaria | BG |  |  | [FATF grey][fatf] |  | Pre-IPO buckets |
| Cameroon | CM |  |  | [FATF grey][fatf] |  | Pre-IPO buckets |
| Central African Republic | CF | [Non-serviceable][xa] | [Prohibited][ps] | [Excluded][ts] |  | **All buckets** |
| China (mainland) | CN |  | [Prohibited][ps] | [Excluded][ts] |  | Pre-IPO buckets |
| Congo, Democratic Republic of the | CD | [Non-serviceable][xa] | [Prohibited][ps] | [Excluded][ts]; [FATF grey][fatf] |  | **All buckets** |
| Cuba | CU | [Non-serviceable][xa] | [Prohibited][ps] |  | [Comprehensive][ofac-cu] ⁵ | **All buckets** |
| Côte d'Ivoire | CI |  | [Prohibited][ps] | [FATF grey][fatf] |  | Pre-IPO buckets |
| Eritrea | ER |  | [Prohibited][ps] |  |  | Pre-IPO buckets |
| Ethiopia | ET | [Non-serviceable][xa] | [Prohibited][ps] |  |  | **All buckets** |
| Guam | GU | [U.S. (Reg S)][xc] ¹ |  | [Excluded (U.S. territory)][ts] |  | **All buckets** |
| Haiti | HT | [Non-serviceable][xa] |  | [FATF grey][fatf] |  | **All buckets** |
| Hong Kong | HK |  |  | [PRC?][ts] ⁴ |  | Pre-IPO buckets |
| Iran | IR | [Prohibited][xa]; [FATF call for action][xc] | [Prohibited][ps] | [Excluded][ts]; [FATF black][fatf] | [Comprehensive][ofac-ir] ⁵ | **All buckets** |
| Iraq | IQ | [Non-serviceable][xa] | [Prohibited][ps] | [FATF grey][fatf] |  | **All buckets** |
| Kenya | KE |  |  | [FATF grey][fatf] |  | Pre-IPO buckets |
| Kosovo | XK |  | [Prohibited][ps] |  |  | Pre-IPO buckets |
| Kuwait | KW |  |  | [FATF grey][fatf] |  | Pre-IPO buckets |
| Lao PDR | LA |  |  | [FATF grey][fatf] |  | Pre-IPO buckets |
| Lebanon | LB | [Non-serviceable][xa] | [Prohibited][ps] | [FATF grey][fatf] |  | **All buckets** |
| Liberia | LR |  | [Prohibited][ps] |  |  | Pre-IPO buckets |
| Libya | LY | [Non-serviceable][xa] | [Prohibited][ps] | [Excluded][ts] |  | **All buckets** |
| Macau | MO |  |  | [PRC?][ts] ⁴ |  | Pre-IPO buckets |
| Mali | ML | [Non-serviceable][xa] | [Prohibited][ps] | [Excluded][ts] |  | **All buckets** |
| Monaco | MC |  |  | [FATF grey][fatf] |  | Pre-IPO buckets |
| Montenegro | ME |  | [Prohibited][ps] |  |  | Pre-IPO buckets |
| Mozambique | MZ | [Non-serviceable][xa] |  |  |  | **All buckets** |
| Myanmar | MM | [Non-serviceable][xa]; [FATF call for action][xc] | [Prohibited][ps] | [FATF black][fatf] |  | **All buckets** |
| Nepal | NP |  |  | [FATF grey][fatf] |  | Pre-IPO buckets |
| Nicaragua | NI | [Non-serviceable][xa] | [Prohibited][ps] |  |  | **All buckets** |
| Nigeria | NG | [Non-serviceable][xa] |  |  |  | **All buckets** |
| North Korea (DPRK) | KP | [Prohibited][xa]; [FATF call for action][xc] | [Prohibited][ps] | [Excluded][ts]; [FATF black][fatf] | [Comprehensive][ofac-kp] ⁵ | **All buckets** |
| Northern Mariana Islands | MP | [U.S. (Reg S)][xc] ¹ |  | [Excluded (U.S. territory)][ts] |  | **All buckets** |
| Panama | PA |  | [Prohibited][ps] |  |  | Pre-IPO buckets |
| Papua New Guinea | PG |  |  | [FATF grey][fatf] |  | Pre-IPO buckets |
| Philippines | PH | [Non-serviceable][xa] |  |  |  | **All buckets** |
| Puerto Rico | PR | [U.S. (Reg S)][xc] ¹ |  | [Excluded (U.S. territory)][ts] |  | **All buckets** |
| Russia | RU | [Non-serviceable][xa] | [Prohibited][ps] | [Excluded][ts] |  | **All buckets** |
| Serbia | RS |  | [Prohibited][ps] |  |  | Pre-IPO buckets |
| Singapore | SG |  | [Prohibited][ps] |  |  | Pre-IPO buckets |
| Somalia | SO | [Non-serviceable][xa] | [Prohibited][ps] | [Excluded][ts] |  | **All buckets** |
| South Sudan | SS | [Non-serviceable][xa] | [Prohibited][ps] | [Excluded][ts]; [FATF grey][fatf] |  | **All buckets** |
| Sudan | SD | [Non-serviceable][xa] | [Prohibited][ps] | [Excluded][ts] |  | **All buckets** |
| Switzerland | CH | [Professional investors only][xc] ³ |  |  |  | **All buckets** |
| Syria | SY | [Prohibited][xa] | [Prohibited][ps] | [FATF grey][fatf] |  | **All buckets** |
| U.S. Minor Outlying Islands | UM | [U.S. (Reg S)][xc] ¹ |  | [Excluded (U.S. territory)][ts] |  | **All buckets** |
| U.S. Virgin Islands | VI | [U.S. (Reg S)][xc] ¹ |  | [Excluded (U.S. territory)][ts] |  | **All buckets** |
| Ukraine (whole country) | UA |  | [Prohibited][ps] |  |  | Pre-IPO buckets |
| United Kingdom | GB | [Not for UK clients][xb] ² |  |  |  | **All buckets** |
| United States | US | [Prohibited][xa] | [Prohibited][ps] | [Excluded][ts] |  | **All buckets** |
| Venezuela | VE | [Non-serviceable][xa] | [Prohibited][ps] | [FATF grey][fatf] |  | **All buckets** |
| Vietnam | VN |  |  | [FATF grey][fatf] |  | Pre-IPO buckets |
| Yemen | YE | [Non-serviceable][xa] | [Prohibited][ps] | [Excluded][ts]; [FATF grey][fatf] |  | **All buckets** |
| Zimbabwe | ZW | [Non-serviceable][xa] | [Prohibited][ps] |  |  | **All buckets** |

Totals: `blockAll` has 35 codes. `blockPreIpo` has 61 (the same 35 plus 26).

## The tighter pre-IPO list, and why it is tighter

The 26 codes blocked only for buckets holding PreStocks or Tessera tokens:

| Added by | Codes |
| --- | --- |
| PreStocks only | AL Albania, ER Eritrea, LR Liberia, ME Montenegro, PA Panama, RS Serbia, SG Singapore, UA Ukraine (whole country), XK Kosovo |
| Tessera only (FATF grey list via clause 3.1(c)(i)(15)) | AO Angola, BG Bulgaria, BO Bolivia, CM Cameroon, KE Kenya, KW Kuwait, LA Lao PDR, MC Monaco, NP Nepal, PG Papua New Guinea, VN Vietnam |
| Tessera, uncertain (PRC reading) | HK Hong Kong, MO Macau |
| Both | BA Bosnia and Herzegovina, CI Côte d'Ivoire, CN China (mainland), VG British Virgin Islands |

Two consequences for product:

1. **Bulgaria is an EU member state.** An EU launch would still exclude Bulgarian users from pre-IPO buckets while Bulgaria stays on the FATF grey list.
2. The Tessera grey-list reference moves three times a year (FATF plenaries in February, June and October). The October 2026 plenary may change the list. Someone must re-check it after each plenary, not only in the quarterly review.

An option to put to counsel: give PreStocks-only and Tessera-only pre-IPO buckets separate lists instead of one union. That would unblock, for example, Singapore for Tessera-only buckets. It adds complexity and is not recommended for v1.

## Regions below country level

Some restrictions cover regions, not whole countries. ISO 3166-1 cannot express these, so they are in a separate block. The backend needs a geo-IP provider that returns ISO 3166-2 subdivisions.

| Region | ISO 3166-2 | Why | Source |
| --- | --- | --- | --- |
| Crimea (Autonomous Republic) | UA-43 | OFAC region-wide program (E.O. 13685); Backed "Occupied regions of Ukraine" | [OFAC Ukraine-/Russia-related](https://ofac.treasury.gov/sanctions-programs-and-country-information/ukraine-russia-related-sanctions), [Backed][xa] |
| Sevastopol | UA-40 | As Crimea | Same |
| Donetsk oblast (so-called DNR) | UA-14 | OFAC E.O. 14065; Backed "Occupied regions" | Same |
| Luhansk oblast (so-called LNR) | UA-09 | OFAC E.O. 14065; Backed "Occupied regions" | Same |
| Zaporizhzhia oblast | UA-23 | Backed "Occupied regions of Ukraine" (undefined; inclusion **uncertain**) | [Backed][xa] |
| Kherson oblast | UA-65 | Backed "Occupied regions of Ukraine" (undefined; inclusion **uncertain**) | [Backed][xa] |

For pre-IPO buckets this is moot: PreStocks blocks all of Ukraine. For xStocks-only buckets, geo-IP at oblast level is unreliable in occupied areas, and counsel may prefer to block all of `UA` for every bucket. That is a one-line change.

## OFAC baseline

- **Country-wide programs** commonly treated as comprehensive: **Cuba, Iran, North Korea**, and the **Crimea region and the so-called DNR and LNR regions of Ukraine**. Program pages: [Cuba](https://ofac.treasury.gov/sanctions-programs-and-country-information/cuba-sanctions), [Iran](https://ofac.treasury.gov/sanctions-programs-and-country-information/iran-sanctions), [North Korea](https://ofac.treasury.gov/sanctions-programs-and-country-information/north-korea-sanctions), [Ukraine-/Russia-related](https://ofac.treasury.gov/sanctions-programs-and-country-information/ukraine-russia-related-sanctions) (E.O. 13685 on Crimea; E.O. 14065 on the DNR/LNR regions). The program pages list the executive orders and regulations; they do not use the word "comprehensive". That label is the usual industry reading and **counsel should confirm it**. The full program list is at [Sanctions Programs and Country Information](https://ofac.treasury.gov/sanctions-programs-and-country-information).
- **Syria is no longer comprehensively sanctioned by OFAC.** OFAC's [PAARSS page](https://ofac.treasury.gov/sanctions-programs-and-country-information/paarss) says: "OFAC no longer maintains comprehensive sanctions on Syria or blocking sanctions on the Government of Syria." Syria stays in `blockAll` because Backed lists it as "Prohibited" and PreStocks lists it too.
- **Russia, Belarus, Venezuela and others** are under list-based and sectoral programs, not country-wide embargoes. They are in `blockAll` anyway because Backed lists them.
- Bucket has no stated incorporation yet. If Bucket or its operators are in the EU or UK, **EU and UK sanctions regimes** also apply, and PreStocks' terms name them expressly. Counsel should add any country-wide EU or UK measures once the Bucket entity's home is known.

## Person-level screening (not geo)

Country blocks do not catch sanctioned people. Every issuer also bars listed persons:

- Backed: persons "subject to international sanctions (in particular as imposed by Switzerland, the United Nations, the USA as well as the European Union)"; the xStocks contract "may block interactions with addresses which have been flagged as sanctioned".
- PreStocks: OFAC SDNs and anyone subject to OFAC, UN, UK or EU measures, or acting for them.
- Tessera: anyone on the UN Consolidated List.

**Recommendation for engineering:** screen every connecting wallet against a blockchain-analytics sanctions API (Chainalysis, TRM or similar) before mint, create and pool-swap through the app. Screen the creator's wallet at bucket creation and on every edit. Log results. Counsel should decide whether a positive hit also blocks exit.

## Considered, not in the JSON

These are not issuer terms, or are unverified. Counsel should decide.

| Jurisdiction | Why it came up | Source | Status |
| --- | --- | --- | --- |
| European Union / EEA (for pre-IPO) | CoinDesk reported PreStocks as "unavailable to residents of the U.S., Singapore, the European Union, and certain sanctioned jurisdictions" (13 May 2026). The PreStocks terms of 8 Sep 2026 do not list the EU | [CoinDesk](https://www.coindesk.com/markets/2026/05/13/anthropic-openai-tokens-plunge-nearly-40-as-ai-firms-warn-spv-transfers-are-invalid) | Uncertain. Ask PreStocks |
| Canada, Australia, India, UAE, Kazakhstan, New Zealand, Singapore, Hong Kong (and US, UK, Philippines) | Kraken's **xStocks Vaults**, the issuer group's own pooled vault product on xStocks, are not offered there | [xStocks news, 14 Sep 2026](https://xstocks.fi/news/xstocks-vaults-go-live-on-kraken-bringing-defi-yield-to-tokenized-equities-on-an-exchange) | The closest analogue to a Bucket vault. Strong candidate for `blockAll` pending counsel |
| Canada, Australia | A search-result summary said Kraken does not offer xStocks there | kraken.com unreachable (DNS failure) | Unverified |
| EEA retail generally | Backed's EEA retail distribution runs through a MiFID II investment firm. Bucket is not one | [xstocks.fi](https://xstocks.fi/) footer | Not a geo block by the issuer. It is the main licensing question in `counsel-brief.md` |
| Jersey, Guernsey, Isle of Man | Not part of the UK; not listed by any issuer | — | Not blocked |
| Any jurisdiction where Tessera "would be subject of licensing", or where PreStocks lacks a needed licence | Catch-all clauses in both terms | [Tessera][ts], [PreStocks][ps] | Cannot be turned into a list without a legal survey |
| Bucket's own home jurisdiction and launch countries | Not decided | — | Counsel |

## Limits of geo-blocking (for counsel)

- Bucket tokens are freely transferable Solana tokens with a public Meteora pool. `mint` and `redeem` are permissionless program instructions. A blocked person can bypass the app entirely. Geo-blocking the app therefore controls **Bucket's own offer**, not who ends up holding a bucket token.
- PreStocks and Tessera restrict **citizens** as well as residents, and PreStocks forbids VPN circumvention. Geo-IP cannot detect citizenship or VPNs. An attestation at sign-up ("I am not a citizen or resident of …") is the practical step. Counsel should decide whether that is enough.
- The Privy funding providers run their own country lists. Those can only narrow, never widen, this list.

## Machine-readable lists

Country level (ISO 3166-1 alpha-2). `XK` (Kosovo) is not an official ISO code but is the code most geo-IP providers use. `blockPreIpo` already contains all of `blockAll`.

```json
{"blockAll": ["AF", "AS", "BY", "CD", "CF", "CH", "CU", "ET", "GB", "GU", "HT", "IQ", "IR", "KP", "LB", "LY", "ML", "MM", "MP", "MZ", "NG", "NI", "PH", "PR", "RU", "SD", "SO", "SS", "SY", "UM", "US", "VE", "VI", "YE", "ZW"], "blockPreIpo": ["AF", "AL", "AO", "AS", "BA", "BG", "BO", "BY", "CD", "CF", "CH", "CI", "CM", "CN", "CU", "ER", "ET", "GB", "GU", "HK", "HT", "IQ", "IR", "KE", "KP", "KW", "LA", "LB", "LR", "LY", "MC", "ME", "ML", "MM", "MO", "MP", "MZ", "NG", "NI", "NP", "PA", "PG", "PH", "PR", "RS", "RU", "SD", "SG", "SO", "SS", "SY", "UA", "UM", "US", "VE", "VG", "VI", "VN", "XK", "YE", "ZW"]}
```

Optional, subdivision level (ISO 3166-2), kept separate so the loader above is unchanged. Applies to every bucket; pre-IPO buckets already block all of `UA`.

```json
{"blockRegionsAll": ["UA-09", "UA-14", "UA-23", "UA-40", "UA-43", "UA-65"]}
```

## Keeping it current

- Re-check the three issuer pages and the FATF lists after each FATF plenary (February, June, October) and at the quarterly legal review in the checklist.
- A change to an issuer's list should trigger a config change, not a deploy. Keep this JSON in config.
- Record the date each list was checked next to the JSON when it is loaded.

[xa]: https://assets.backed.fi/legal-documentation/restricted-countries "Backed: Restricted Countries (Prohibited / Non-Serviceable), accessed 21 Sep 2026"
[xb]: https://assets.backed.fi/legal-documentation "Backed: Legal Documentation, site-entry notice 'NOT available for UK Clients', accessed 21 Sep 2026"
[xc]: https://cdn.prod.website-files.com/655f3efc4be468487052e35a/6a748b81c9b1aca19a11c102_Backed_Assets_Base%20Prospectus_20260727.pdf "Backed Assets (JE) Ltd Base Prospectus dated 8 May 2026: U.S. (p. 2), Switzerland (p. 8), (Re-)Selling Restrictions 4.1.7"
[ps]: https://url.prestocks.com/terms-of-service "PreStocks Terms of Service, Last Updated 8 Sep 2026, 'Prohibited Jurisdictions', accessed 21 Sep 2026"
[ts]: https://terms.tessera.pe/ "Tessera Terms and Conditions, Date Last Revised 28 Aug 2026, clause 3.1(c)(i), accessed 21 Sep 2026"
[fatf]: https://fiaumalta.org/news/fatf-public-statements-19th-june-2026/ "FATF lists of 19 June 2026 as restated by FIAU Malta (fatf-gafi.org returned 403)"
[ofac-cu]: https://ofac.treasury.gov/sanctions-programs-and-country-information/cuba-sanctions "OFAC Cuba Sanctions"
[ofac-ir]: https://ofac.treasury.gov/sanctions-programs-and-country-information/iran-sanctions "OFAC Iran Sanctions"
[ofac-kp]: https://ofac.treasury.gov/sanctions-programs-and-country-information/north-korea-sanctions "OFAC North Korea Sanctions"
