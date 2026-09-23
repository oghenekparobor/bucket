> DRAFT — prepared by an engineering assistant for review by qualified counsel. Not legal advice. Not reviewed.

# Issuer terms: xStocks, PreStocks, Tessera

Checklist item 0.2: *Read the xStocks, PreStocks and Tessera terms. Confirm a program-owned vault may hold their tokens and issue a token against them.*

Every page below was fetched on **21 September 2026**. Quotes are copied from the fetched text; nothing is paraphrased inside quotation marks. Where a document was fetched in a way other than a plain page load, the method is noted. Where the terms say nothing on a point, this file says "silent" and does not guess.

On-chain facts come from `getAccountInfo` (jsonParsed) against Solana mainnet on 21 Sep 2026. They confirm `docs/spikes/token-programs.md`.

---

## 1. xStocks (Backed)

### 1.1 Who and what

| Item | Finding | Source |
| --- | --- | --- |
| Issuer | Backed Assets (JE) Limited, private limited company, Jersey. Reg. no. 152608. LEI 984500001AB7C6C7F577. First Floor, La Chasse Chambers, Ten La Chasse, St. Helier, JE2 4UE | [assets.backed.fi/legal-documentation/issuer](https://assets.backed.fi/legal-documentation/issuer) |
| Regulatory status | "COBO and CGPO consents by the Jersey Financial Services Commission (JFSC)". EU base prospectus approved by the Liechtenstein FMA on 8 May 2026, valid to 7 May 2027, passported to the EEA states listed in it | Same page; [legal-documentation](https://assets.backed.fi/legal-documentation) |
| Ownership | 100% Backed Finance AG, Zug. Base Prospectus 3.7: "The Parent is itself 100% owned by Payward Europe Limited, Ireland which is in turn 100% owned by Payward, Inc., US" (Payward is Kraken's group) | Base Prospectus, see 1.6 |
| Website operator | xstocks.fi / xstocks.com are run by Backed Finance AG (Swiss), informational only | [xStocks Terms of Service PDF](https://xstocks.fi/documents/xstocks-terms-of-service.pdf) |
| Governing law of the product | Base Prospectus and Products: Jersey law, Jersey courts (non-exclusive). Registration Agreement (the token ledger): Swiss law. xstocks.fi website terms: Swiss law, courts of Zug | ToS Exhibit A, clause XXVIII; xStocks ToS clause 9 |

**What the token legally is.** A tracker certificate: a debt security, issued as a Swiss-law ledger-based security, tracking one share or ETF 1:1, collateralised by the underlying held with custodians, with a security agent.

- "Each xStock is a bearer debt instrument classified as a tracker certificate." ([Product Legal Overview](https://docs.xstocks.fi/docs/product-legal-overview))
- "It provides economic exposure to the underlying equity. It does not confer shareholder voting rights." (same)
- "The Investors in a Product are not entitled to any rights or claims to the Underlying or the Underlying Components or the Collateral, i.e. the Investors do not have any dividend, voting, pre-emption rights …" (Offering Terms III, in the [Backed Terms of Service PDF, 18 Nov 2025](https://cdn.prod.website-files.com/65520d8e3ee74f07f306dcc7/692471402b7e906aca43d732_Terms%20of%20Service%20JE%20(18%20November%202025).pdf))
- "Although xStocks are issued as securities under the frameworks of Jersey and the European Union, other jurisdictions may classify them differently, including as crypto assets. Licensing requirements for distribution vary accordingly." ([Product Legal Overview](https://docs.xstocks.fi/docs/product-legal-overview))
- Swiss view: "The securities issued are structured products (and debt instruments) according to Swiss Law. The securities do not constitute a collective investment scheme within the meaning of the Swiss Collective Investment Schemes Act" (Base Prospectus, Important Information, "Switzerland").

The NVDAx Final Terms (dated 8 May 2026) list the Solana address `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` as a Securities Ledger address for that product, which matches the mint in our spike. ([NVDAx Final Terms, ISIN CH1436219195](https://sppdownloaddocumentservice.l-p-a.com/api/DownloadDocument/UPI/CH1436219195/BF%20Final%20Terms%20AND%20Summary%20%28PDF%29), link built the same way the Backed product page builds it.)

### 1.2 Who may hold it

- **Primary market (issue and redeem with Backed): professional/qualified investors only, KYC, $5,000 minimum.** "Purchase of Products directly from Backed Assets is limited only to Qualified Users and API Users." (ToS 5.2). "The minimum subscription amount is USD 5,000." (NVDAx Final Terms). "Retail users are legally permitted to redeem directly with the issuer, subject to KYC requirements and the $5,000 minimum transaction size." ([xStocks FAQ](https://docs.xstocks.fi/docs/frequently-asked-questions)). Primary-market wallets must be whitelisted: "Only whitelisted wallets may interact with the platform." ([Issuance and Redemption](https://docs.xstocks.fi/docs/issuance-and-redemption))
- **Retail access is through licensed distributors.** "Backed tokenized financial assets are not offered directly to the public and will only be offered through licensed entities." ([legal-documentation](https://assets.backed.fi/legal-documentation)). The xstocks.fi footer names Payward Digital Solutions Ltd (Bermuda) and, in the EU/EEA, "Payward Europe Digital Solutions (CY) Ltd. (“PEDLS-CY”), a Cyprus investment firm authorized and regulated under MiFID II." ([xstocks.fi](https://xstocks.fi/))
- **Secondary market: permissionless, but holders are deemed to make representations.** "xStocks are permissionless tokenized representations of publicly traded stocks and ETFs." and "Are xStocks freely transferable? Yes." ([FAQ](https://docs.xstocks.fi/docs/frequently-asked-questions)). But: "Each Investor who acquires Products on the secondary market will be deemed, by such acquisition, to have represented that: (a) they have read this Base Prospectus and Final Terms; (b) they have received and acknowledged the warning set out above under the JFSC Guidance …; they understand the risks set out above; that the Products are suitable for them …; and (c) under the SPB Order …, they are a Professional Investor …, or alternatively they will be deemed … to have represented that they have received and acknowledged the SPB Order Investment Warning" (Base Prospectus, p. 5).
- **Jersey characterisation depends on sophisticated investors.** "The Products do not constitute a collective investment fund for the purpose of the Collective Investment Funds (Jersey) Law 1988, as amended, on the basis that they are investment products designed for financially sophisticated investors with specialist knowledge of, and experience of investing in, such investments … The Products are not regarded by the JFSC as suitable investments for any other type of investor." (Base Prospectus, p. 4)
- **Switzerland: professional investors only.** "The securities, qualifying as structured products pursuant to Article 70 of the Swiss Financial Services Act ("FinSA"), may be offered exclusively to professional investors … Circulating this document and offering, distributing, marketing or selling the securities to other Swiss persons than Swiss Professional Investors may trigger regulatory obligations in Switzerland. Accordingly, legal advice should be sought before providing this document to and offering, distributing, marketing or selling/on-selling the securities to any other persons or entities." (Base Prospectus, "Switzerland")

### 1.3 Restricted countries and persons (exact lists)

From [assets.backed.fi/legal-documentation/restricted-countries](https://assets.backed.fi/legal-documentation/restricted-countries), accessed 21 Sep 2026:

> **Prohibited Countries.** "Individuals or entities from these countries are prohibited from using Backed products: Iran, North Korea, Syria. These restrictions are due to applicable international sanctions." And: "United States of America. Backed products are not registered with U.S. securities regulators and therefore may not be offered, sold, or made available to U.S. persons or individuals located in the United States."
>
> **Non-Serviceable Countries.** "Backed does not service individuals or entities from these countries: Afghanistan, Belarus, Central African Republic, Congo (Democratic Republic of the), Cuba, Ethiopia, Haiti, Iraq, Lebanon, Libya, Mali, Mozambique, Myanmar, Nicaragua, Nigeria, Occupied regions of Ukraine, Philippines, Russia, Somalia, South Sudan, Sudan, Venezuela, Yemen, Zimbabwe"

Further restrictions from other Backed documents:

| Restriction | Quote | Source |
| --- | --- | --- |
| United Kingdom | "Important Notice: NOT available for UK Clients. The products are not promoted or offered to clients based in the UK. Certain products will only be available to UK professional clients subject to prior validation of their status and approval by Backed Assets." | [legal-documentation](https://assets.backed.fi/legal-documentation) (site-entry notice) |
| United Kingdom | "xStocks are also not currently available in the United Kingdom or in any other jurisdiction where their offer or distribution would be unlawful or would require regulatory authorization that has not been obtained." | [xstocks.fi](https://xstocks.fi/) footer |
| U.S. persons | "may not be offered, sold or delivered within the United States to, or for the account or benefit of U.S. Persons (as defined in Regulation S …), and (ii) may be offered, sold or otherwise delivered at any time only to transferees that are Non-United States Persons (as defined by the U.S. Commodities Futures Trading Commission)." | Base Prospectus p. 2 |
| Sanctions and FATF | "The Products offered on primary and secondary markets and other platforms under this Base Prospectus are not for distribution to any U.S. person or any person or address in the U.S. or in any other jurisdiction (i) to which a distribution would be unlawful (e.g. being subject to Sanctions Regulations, such as residents of North Korea, Syria or Iran), or (ii) which may be classified as high-risk jurisdictions subject to a call for action according to the Financial Action Task Force ("FATF")." | Base Prospectus 4.1.7; ToS Exhibit A XXV |
| More may be added | "The Issuer reserves the right to impose further selling restrictions at its sole discretion which will be communicated in the Final Terms or on its website" | Same |
| Switzerland | Professional investors only (quoted in 1.2) | Base Prospectus |
| Sanctioned persons | Site users confirm "You are neither a US person nor a person subject to international sanctions (in particular as imposed by Switzerland, the United Nations, the USA as well as the European Union)." | [legal-documentation](https://assets.backed.fi/legal-documentation) |

Two notes. First, "Prohibited" applies to "using Backed products"; "Non-Serviceable" says Backed "does not service" them, which reads as the issuer's own services. Bucket's geo list treats both as blocked (strictest-of). Second, "Occupied regions of Ukraine" is not defined on the page; which oblasts it covers is **uncertain**.

### 1.4 Transfers, secondary trading, smart contracts, pooling, repackaging

| Topic | What the documents say | Source |
| --- | --- | --- |
| Transfers | "Solana SPL and ERC-20 tokens without technical transfer restrictions" | [legal-documentation](https://assets.backed.fi/legal-documentation) |
| Transfers | "The ledger-based securities are transferable by (i) any action that technically transfers the direct or indirect power of disposal … and (ii) complying with this Registration Agreement and these Terms and Conditions." | ToS Exhibit A II |
| Secondary trading | "xStocks … can be traded on secondary markets 24/7 like any other token." Issuer "does not control pricing on secondary markets." | [FAQ](https://docs.xstocks.fi/docs/frequently-asked-questions) |
| Onward distribution | "No offers, sales, resales, or deliveries of any Products or distribution of any offering material relating to any Products may be made in or from any jurisdiction except in circumstances which will result in compliance with any applicable laws and regulations and which will not impose any obligation on the Issuer." | Base Prospectus 4.1.7 |
| Intermediaries passing tokens on | "Where an Authorised Participant acquires the Products and then facilitates their transfer to a third party …, the JFSC expects Authorised Participants to provide (and draw a Prospective Investor's attention to) the warnings set out in this section, as well as providing such Prospective Investors with access to this Base Prospectus and the Final Terms prior to any such transfer being made." | Base Prospectus p. 5 |
| Holding by smart contracts / pooled vehicles | **Silent.** No clause permits or forbids it. | — |
| Repackaging, wrapping, issuing tokens or derivatives against xStocks | **Silent.** | — |
| Context, not a term | The issuer's own group runs pooled smart-contract products on xStocks: "xStocks Vaults" on Kraken (14 Sep 2026) are "powered by Veda and operated by Sentora, relying on Privy embedded wallets", lend on Kamino, and "are available everywhere Kraken operates, except US, UK, Canada, Australia, India, UAE, Philippines, Kazakhstan, New Zealand, Singapore, and Hong Kong and sanctioned countries." This shows tolerance of smart-contract holding by the issuer's affiliates. It is not a permission for third parties. | [xStocks news, 14 Sep 2026](https://xstocks.fi/news/xstocks-vaults-go-live-on-kraken-bringing-defi-yield-to-tokenized-equities-on-an-exchange) |
| Website data | xstocks.fi terms forbid using the site "in connection with any commercial endeavors" and "any robot, spider … to retrieve, index, data-mine". The catalog sync should use a sanctioned API or on-chain data, not scraping. | [xStocks ToS](https://xstocks.fi/documents/xstocks-terms-of-service.pdf) 3 |
| Trademarks | "Nothing in these Terms should be construed as granting you any right to use any trademark, service mark, logo, or trade name of Backed Finance" | Same, 6 |

### 1.5 Issuer powers

| Power | Terms | On-chain (NVDAx, 21 Sep 2026) |
| --- | --- | --- |
| Pause | "pausing: ability to stop all transfers of tokens"; "The Tokenizer may pause all transactions … in case of any technological change, discovery of a vulnerability, or hack attempts … limited to the time reasonably required" (ToS Exhibit A II) | `pausableConfig` present, authority `JDq14B…xJNs`, not paused |
| Freeze | "A future update of the smart contract functionality may introduce a freezing function and/or extend the burning function, which then could only be executed by the Tokenizer if (i) the Tokenizer is compelled by a court, a regulator or other governmental authority …" (ToS Exhibit A II) | **Freeze authority is already set** (`JDq14B…xJNs`). The terms describe freezing as future and conditional. **Discrepancy for counsel.** |
| Permanent delegate | **Not mentioned** in the terms I read | **Present**, delegate `5aMNNL…FvEq`. Can move or burn tokens in any account, including a Bucket vault |
| Sanctions blocking | "The smart contract may block interactions with addresses which have been flagged as sanctioned in accordance with Sanctions Regulations (such as OFAC sanctions) … The Issuer will engage an independent third-party service provider, such as Chainalysis, to implement such oracle function." | Transfer hook extension present, program `null` today |
| Code updates, migration | "The Issuer and/or the Tokenizer on behalf of the Issuer may: i. amend or substitute the Securities Ledger, ii. substitute, migrate or transfer the Securities Ledger and the ledger-based securities to another Product-DLT …" | — |
| Forced redemption (Issuer Call Option) | "If an event occurs, which in the sole discretion of the Issuer requires a discontinuation of a Product …, the Issuer has the right to terminate such Product … without providing for a specific reason, by notifying the Investors … no later than 30 Business Days prior to the Termination Date". Non-direct investors are notified only "by publication on the Issuer's website". Recent notices: WBSx (17 Sep 2026, termination 30 Oct 2026, after a merger); EAx, AVBx, EQRx (28 Aug 2026) | [Notices to Investors](https://assets.backed.fi/legal-documentation/notices-to-investors) |
| Corporate actions | Adjustments are made "without the consent of Investors" (ToS Exhibit A IX). Dividends are reinvested and splits applied through a multiplier: "On Solana, the raw onchain balance remains constant and the multiplier is applied for display using the Scaled UI extension." Venues "are advised to pause interactions with the affected token for a brief window around each activation timestamp" ([Dividends and Stock Splits](https://docs.xstocks.fi/docs/dividends-and-stock-splits)) | `scaledUiAmountConfig` multiplier 1.00092, new multiplier 1.00170 effective 10 Sep 2026 00:30 UTC |
| Forks | Issuer decides "whether or not to participate in the Fork" and which chain it recognises | ToS Exhibit A IX.ii |
| Fees | Management fee "up to 0.25% P/A"; issuer investor fee "up to 0.5% … but at least USD 100" on issue and redeem | NVDAx Final Terms |

A terminated xStock is paid out by redemption with the issuer, which needs KYC and the $5,000 minimum. A program-owned vault cannot do KYC, so a Bucket vault would have to sell a terminated xStock on the secondary market before liquidity disappears. See question X6 below.

---

## 2. PreStocks

### 2.1 Who and what

| Item | Finding | Source |
| --- | --- | --- |
| Legal entity | **Not identified.** "PreStocks is a distributed network of contributors located around the world who collaborate primarily through digital means." Terms say the contracting entity "may differ between products, tokens, jurisdictions, and points in time" and "Not all such entities … are or will be publicly identified". FAQ: "Counterparty legal names are not disclosed". | [PreStocks Terms of Service](https://url.prestocks.com/terms-of-service) (Last Updated 8 Sep 2026), "Acceptance" and "The Services and Protocol"; [prestocks.com/faq](https://prestocks.com/faq) |
| Governing law, disputes | British Virgin Islands law; LCIA arbitration seated in London; class-action waiver; confidentiality of disputes | ToS "Governing Law and Jurisdiction", "Dispute Resolution and Arbitration" |
| Regulatory status | "PreStocks is not a broker, dealer, broker-dealer, investment adviser, fund manager … virtual asset service provider, crypto-asset service provider, or any similar regulated entity, and is not registered, licensed, authorized, or supervised as such in any jurisdiction." | ToS "Risk Factors" |

How fetched: `prestocks.com/terms` returns 404. The footer links to `url.prestocks.com/terms-of-service`, which redirects to a Notion page that renders only with JavaScript. I read it through Notion's public `loadPageChunk` endpoint (page id `5af73892-884d-4833-842a-d172487af3fa`). The FAQ answers are only in the site's JavaScript bundle; I read them from there.

**What the token legally is.** A bearer token referencing economic exposure, with no rights against anyone.

- "Pre-IPO Tokens (branded as “PreStocks”; in this Section, “Tokens”) are bearer digital tokens that reference economic exposure to designated pre-IPO companies." (ToS "Pre-IPO Tokens")
- "They confer no ownership, equity, shareholding, beneficial, or proprietary interest in any company; … no creditor, security, priority, or insolvency claim against any company, special purpose vehicle, custodian, or against us; and no legal, equitable, or contractual right to any underlying share or asset." (ToS "Nature of the tokens; absence of rights")
- Backing is not limited to SPVs: exposure "may take any one or more forms … including but not limited to a direct or indirect interest in one or more SPVs, funds, feeders, series, nominee, trust, or custodial arrangements; a contractual, participation, profit-sharing, forward, option, swap, or other derivative or synthetic arrangement …; interests in other companies, indices, or baskets; cash, stablecoins, other digital assets, or other tokens". And: "holding Tokens does not give you any legal, equitable, beneficial, security, or proprietary interest in, or claim over, any collateralizing asset" (ToS "Pre-IPO Tokens").
- The spec and design call PreStocks "SPV-backed" and "backed 1:1 by SPV exposure". The terms allow much more than SPVs and give holders no claim on any of it. The not-shares wording should reflect that (see `not-shares-notice.md`).

### 2.2 Who may hold it

- Anyone who touches a token is bound: "BY USING THE WEBSITE OR OUR SERVICES, OR BY ACQUIRING, HOLDING, TRANSFERRING, OR TRANSACTING IN ANY TOKEN ISSUED BY OR IN CONNECTION WITH US, HOWEVER AND FROM WHOMEVER ACQUIRED, YOU ACCEPT AND AGREE TO BE LEGALLY BOUND BY THESE TERMS AND CONDITIONS." (ToS preamble)
- Participant Agreement, accepted "by interacting with any PreStocks-related token": "I am not a U.S. person. … I am not a Restricted Person and am not located in, a citizen or resident of, or otherwise subject to the laws of any Prohibited Jurisdiction". Age 18+.
- KYC: "No. Buying and selling onchain in DeFi (peer-to-peer) does not require KYC." (FAQ). Redemption is "subject to eligibility, verification, minimum sizes, timing, documentation, fees, and costs" (ToS). No accredited-investor requirement is stated.
- PreStocks may add conditions later, including to existing holders: "(iii) impose eligibility, identity-verification, accreditation, holding-period, lock-up, transfer, position-size, allowlist, or other conditions on the acquisition, holding, transfer, or redemption of any token …, including conditions applied retrospectively to existing holders" (ToS "Monitoring, Compliance, and Enforcement").

### 2.3 Restricted countries and persons (exact list)

From the [PreStocks Terms of Service](https://url.prestocks.com/terms-of-service), "Prohibited Jurisdictions", Last Updated 8 Sep 2026, accessed 21 Sep 2026:

> "The Services are not offered to, and must not be accessed or used by, any person or entity that is a citizen or resident of, incorporated in, or physically located within the following jurisdictions (“Prohibited Jurisdictions”): Afghanistan, Albania, Belarus, Bosnia and Herzegovina, British Virgin Islands, Central African Republic, China (Mainland), Côte d’Ivoire, Cuba, Democratic Republic of the Congo, Eritrea, Ethiopia, Iran, Iraq, Kosovo, Lebanon, Liberia, Libya, Mali, Montenegro, Myanmar (Burma), Nicaragua, North Korea, Panama, Russia, Serbia, Singapore, Somalia, South Sudan, Sudan, Syria, Ukraine (including Crimea and any other region subject to international sanctions), United States, Venezuela, Yemen, and Zimbabwe; any other jurisdiction subject to sanctions or restrictive measures enforced by the Office of Foreign Assets Control (“OFAC”), the United Nations, the U.K., or the E.U.; and any other jurisdiction in which the Services are not offered, or in which offering or using the Services would be unlawful or would require a license, registration, or authorization that we do not hold."

Restricted Persons also include anyone "identified by OFAC as a Specially Designated National or otherwise blocked or designated person", anyone subject to OFAC, UN, UK or EU measures, "or that is acting for or on behalf of, owned or controlled by, or otherwise involved with any such person or entity".

Notes:
- The list covers **all of Ukraine**, not only occupied regions. It covers **citizens** as well as residents, which IP geofencing cannot detect.
- The governing law is BVI, yet the **British Virgin Islands** is a Prohibited Jurisdiction.
- The catch-all ("any other jurisdiction subject to sanctions or restrictive measures enforced by … the U.K., or the E.U.") has no clear edge; the EU and UK run list-based measures touching many countries. **Uncertain.** Counsel should decide how to read it.
- CoinDesk (13 May 2026) reported PreStocks as "unavailable to residents of the U.S., Singapore, the European Union, and certain sanctioned jurisdictions" ([CoinDesk](https://www.coindesk.com/markets/2026/05/13/anthropic-openai-tokens-plunge-nearly-40-as-ai-firms-warn-spv-transfers-are-invalid)). The current terms do not list the EU. Whether the EU was dropped or the report was wrong is **uncertain**.
- The FAQ answer "Are PreStocks available in all countries?" says: "No. PreStocks are unavailable in the United States, in any country subject to US, UK, or EU sanctions, or in any country where their use is prohibited by law."

### 2.4 Transfers, secondary trading, smart contracts, pooling, repackaging

| Topic | Quote | Source |
| --- | --- | --- |
| Pooling, wrapping, derivatives by third parties | "Tokens are transferable on permissionless networks, and may be listed, quoted, wrapped, bridged, pooled, lent against, used as collateral, or otherwise made available by any person on any venue at any time, without our involvement, knowledge, consent, or approval. We do not endorse, verify, support, or accept any responsibility for any such listing, venue, pool, wrapper, derivative, or integration" | ToS "Third-party sites, services, and content" |
| Structured products | "You can lend out your PreStocks to earn yield, use them as collateral to take out loans, provide exchange liquidity to earn trading fees, or use them to build new structured products." | [FAQ](https://prestocks.com/faq) |
| Transfers | "All blockchain transfers via the Services are secondary transfers effected outside the United States and are not primary offerings to U.S. persons." | ToS "Pre-IPO Tokens" |
| Fees at token level | Fees "may apply automatically to any and every transaction in a token — including each transfer, trade, deposit, withdrawal, wrap, unwrap, stake, unstake, bridge, mint, burn, or redemption — wherever and however that transaction occurs, including on third-party exchanges, marketplaces, liquidity pools …" and may change "without prior notice to you and without your consent" | ToS "Fees" |
| Holding by a program on behalf of others | **Silent** beyond the clauses above. Nothing expressly forbids it. The Participant Agreement reps are written for a person ("I am not a U.S. person"). | — |

So PreStocks' terms **anticipate** pooling and wrapping and **disclaim** them. They neither authorise nor forbid a Bucket vault. They do reserve the right to act against any address "in order to protect the integrity of the Services … or for any other legal, regulatory, compliance, risk-management, security, or operational reason".

### 2.5 Issuer powers

"Tokens of this kind are issued with administrative controls … including freeze, pause, permanent-delegate, clawback, forced-transfer, burn, mint, upgrade-authority, transfer-hook, allowlist, and blocklist capabilities." PreStocks may, "at any time, without prior notice and without your consent: (a) freeze, lock, or render non-transferable any token held by or attributable to any wallet or person; (b) recover, claw back, or compulsorily transfer or re-assign any token; (c) burn, cancel, or otherwise extinguish any token; (d) compulsorily redeem any token at a value determined by us by reference to the proceeds we are able to realize, which may be substantially below any market, indicative, or acquisition price and in some circumstances nil; and (e) add any blockchain address to a blocklist" (ToS "Monitoring, Compliance, and Enforcement").

It may also "migrate, re-issue, re-deploy, wrap, convert, split, consolidate, or replace any token … and cause superseded tokens or contracts to cease functioning or to be frozen, burned, or rendered non-transferable", and "restrict, suspend, disable, deprecate, delist, pause, wind down, compulsorily redeem, or permanently discontinue any token".

On-chain (SpaceX PreStocks mint, 21 Sep 2026): mint, freeze, permanent delegate, pause, transfer-fee config and scaled-UI authorities are all the same key `WV9PJN…i5Wc`. Transfer fee 100 bps (was 50 bps until epoch 1039). Transfer hook extension present with program `null`. Scaled-UI multiplier 1 → 5 with effective timestamp **10 June 2026 04:30 UTC**, already past, so the ×5 multiplier is now in force. `token-programs.md` describes it as "scheduled"; engineering should re-check.

**Corporate actions and deadlines (FAQ):**
- IPO: "Holders will have up to 9 months after IPO (3 months after the 6 month lockup period) to convert their PreStocks tokens into the equivalent tokenized public stock. After the 9-month post-IPO conversion deadline, the tokens will expire worthless and will no longer be supported."
- M&A: "Holders will have up to 6 months to convert after the conversion period opens. After that deadline, the tokens will expire worthless and will no longer be supported."
- **SpaceX has already listed.** The SpaceX page says: "SpaceX has gone public! SpaceX PreStocks tokens must be swapped into $SPCXx or any other token before 11:59pm UTC on 12 March 2027, or they will expire worthless." ([prestocks.com/spacex](https://prestocks.com/spacex)). SpaceX PreStocks is no longer a pre-IPO token, and any bucket holding it must swap it out before that date.

**Company objections.** "Referenced companies may object to, restrict, challenge, or take legal or contractual action in respect of any tokenization, exposure, or transfer arrangement, and may have the ability to impair or extinguish the arrangements underlying a token." In May 2026 Anthropic said: "We do not permit special purpose vehicles to acquire Anthropic stock and any transfer of shares to an SPV are void under our transfer restrictions", and OpenAI issued a similar warning; the tokens fell 34–39% in a week (CoinDesk, above).

---

## 3. Tessera

### 3.1 Who and what

| Item | Finding | Source |
| --- | --- | --- |
| Platform operator | Tessera Works Foundation ("TWF"), a Panama foundation, Ricardo Arias Street, Advanced Tower Building, First Floor, Panama City. Registered at folio 25063391 | [Terms and Conditions](https://terms.tessera.pe/) (Date Last Revised 28 Aug 2026); [Disclosures](https://terms.tessera.pe/disclosures) (28 Aug 2026) |
| Token issuers | One Panama subsidiary per token: SPX Tessera Issuer Inc. (T-SpaceX, folio 155779878), KLSH Tessera Issuer Inc. (T-Kalshi, folio 155774530), OPAI Tessera Issuer Inc. (T-OpenAI, folio 155785695) | Terms preamble; Disclosures §1 |
| Underlying vehicle | "Each issuer entity enters into a loan agreement with its own segregated portfolio inside a Cayman Islands SPC" | [How do T-Tokens Work?](https://docs.tessera.pe/overview/how-do-tessera-token-work) |
| Governing law, disputes | Singapore law; SIAC arbitration; class-action waiver | Terms 8, 10.1 |
| Legal opinion | "The product carries a non-security legal opinion under Singapore law, confirming it is structured as a loan product, not a capital markets product." (docs, not terms; opinion not published) | How do T-Tokens Work? |

**What the token legally is.** The terms call it a "Stablecoin Loan Token": the holder has lent stablecoins to the issuer, which repays only from exit proceeds.

- "A User who participates in a Lending Opportunity by extending a Stablecoin Loan … to the relevant Issuer would receive from that Issuer a token ("Stablecoin Loan Token") on the basis of a one (1) Accepted Stablecoin of Digital Asset Loan : 1 Stablecoin Loan Token." (Terms 1.4)
- "The obligations of that Issuer in respect of that Stablecoin Loan are limited to the Liquidity Event Proceeds actually received by it, and the holder of those Stablecoin Loan Tokens shall have recourse in respect of those obligations only to those Liquidity Event Proceeds." (Terms 2.2(a)(iii))
- "This Section 2.2(b) imposes a contractual obligation on that Issuer only, and does not confer on any User any legal, beneficial or other proprietary interest in those Liquidity Event Proceeds, in any PE Investment or in any asset of that Issuer." (Terms 2.2(b))
- "the loan to the issuer entity is **unsecured** and is not collateralised by the underlying shares." (docs)
- Tessera docs describe T-Tokens as "loan participation rights, not securities, though regulatory treatment may vary by jurisdiction."

The loan series are small: principal of 500,990.00 USDC (T-SpaceX), 552,500.00 USDC (T-Kalshi), 518,171.45 USDC (T-OpenAI) (Disclosures §3). The Disclosures (28 Aug 2026) record a novation of the T-SpaceX issuer on 1 Aug 2026 and state that T-SpaceX "has entered its redemption event cycle. No Liquidity Event Proceeds had been received … so no Redemption Start Date has been announced".

### 3.2 Who may hold it

- Terms bind anyone who uses Tessera "whether by Website Access or Direct Access", including smart contracts accessed directly.
- Reps (Terms 3.1): not an Excluded Person; "sophisticated in using and evaluating blockchain technologies …, as well as smart contract systems, automated market making protocols and the concept of pricing slippage". No accreditation requirement.
- KYC: none by default. The issuer "may require a User to provide such information as that Issuer may require in order to discharge its identity verification, anti-money laundering, counter-terrorism financing and sanctions screening obligations" (Terms 2.1(d)). The home page says "No KYC, no accreditation requirements, no geographic restrictions." ([tessera.pe](https://www.tessera.pe/)). **The "no geographic restrictions" claim contradicts the Terms.**

### 3.3 Restricted countries and persons (exact list)

From the [Tessera Terms and Conditions](https://terms.tessera.pe/), clause 3.1(c)(i), Date Last Revised 28 Aug 2026, accessed 21 Sep 2026:

> ""Excluded Jurisdiction" means any of the following jurisdictions: (1) the United States of America and its territories and possessions (collectively, the "United States"); (2) the People's Republic of China; (3) the Central African Republic; (4) the Democratic People's Republic of Korea; (5) the Democratic Republic of Congo; (6) Belarus; (7) Iran; (8) Libya; (9) Mali; (10) Russia; (11) Somalia; (12) South Sudan; (13) Sudan; (14) Yemen; (15) any other jurisdiction identified by the Financial Action Task Force (FATF) for strategic AML/CFT deficiencies and included in FATF's listing of "High-risk and Other Monitored Jurisdictions" accessible at https://www.fatf-gafi.org/en/publications/High-risk-and-other-monitored-jurisdictions/increased-monitoring-june-2025.html or "Jurisdictions Subject to a Call for Action" accessible at https://www.fatf-gafi.org/en/publications/High-risk-and-other-monitored-jurisdictions/Call-for-action-june-2025.html and such updated list as may be available on https://www.fatf-gafi.org/en/publications.html; (16) a jurisdiction in which Tessera would be subject of licensing; and/or (17) a jurisdiction in which the offering of, or access and/or use of Tessera is prohibited, restricted or unauthorised in any form or manner whether in full or in part under the laws, regulatory requirements or rules in such jurisdiction"

Excluded Persons (3.1(c)(ii)) include citizens, residents and people physically present in an Excluded Jurisdiction, companies incorporated there or controlled from there, anyone on the UN Consolidated List, and "a U.S. person" (defined at length, Regulation S style).

Item (15) pulls in the FATF grey and black lists. I could not load fatf-gafi.org (HTTP 403). The June 2026 lists, as restated by Malta's FIAU ([FIAU, 19 Jun 2026](https://fiaumalta.org/news/fatf-public-statements-19th-june-2026/)) and Singapore's MAS ([MAS June 2026 FATF Statement](https://www.mas.gov.sg/publications/fatf-statement/2026/june-2026)), are:

- **Call for action:** Iran, DPRK, Myanmar.
- **Increased monitoring (22):** Angola, Bolivia, Bosnia and Herzegovina, Bulgaria, Cameroon, Côte d'Ivoire, Democratic Republic of the Congo, Haiti, Iraq, Kenya, Kuwait, Lao PDR, Lebanon, Monaco, Nepal, Papua New Guinea, South Sudan, Syria, Venezuela, Vietnam, Virgin Islands (UK), Yemen. (FIAU: Algeria and Namibia were removed in June 2026; Bosnia and Herzegovina and Iraq were added; Kuwait and Papua New Guinea deferred reporting and remain listed.)

This pulls in **Bulgaria and Monaco** among others. Whether clause (15) means the June 2025 lists it links, the current lists, or both is **uncertain**; this file assumes the current lists.

"People's Republic of China" is not defined. Whether it covers Hong Kong and Macau is **uncertain**; the geo list blocks them for pre-IPO buckets until counsel decides.

### 3.4 Transfers, secondary trading, smart contracts, pooling, repackaging

| Topic | Quote | Source |
| --- | --- | --- |
| Transfers are "Tessera Transactions" and carry a fee | "A transaction fee ("Transaction Fee") shall be chargeable to a User for each Tessera-related transaction ("Tessera Transaction") initiated through the Tessera Smart Contracts – whether transferring of Stablecoin Loan Tokens, extending a Stablecoin Loan or effecting Redemption." Fee is 0.2% on transfer and "the project can update fee rates" | Terms 1.15(a); [Transfer fees](https://docs.tessera.pe/features/token-system-and-fees/transfer) |
| **No use of your wallet by others** | Rep: "THAT you will not, and will not attempt to, authorise anyone other than you to access and/or use Tessera using a Tessera-compatible wallet owned by you or for which you control the private keys" (3.1(d)). Prohibited use: "permit others to access and/or use Tessera or otherwise undertake any Tessera Activity and/or Tessera Transaction using a Tessera-compatible wallet address that you control" (4.1(c)) | Terms |
| Resale of Tessera content | Prohibited: "copy, reproduce, republish, upload, post, transmit, resell, or distribute in any way, any data, content or any part of Tessera" (4.1(h)) | Terms |
| Assignment | "These Terms, and your rights and obligations herein, may not be assigned, subcontracted, delegated, or otherwise transferred by you without TWF's prior written consent" (11.5) | Terms |
| Front-running | Prohibited: "'front-running', 'wash trading', 'pump and dump schemes', or similar activities" (4.1(e)) | Terms |
| Secondary trading | "Tessera's Terms and Conditions do not prohibit secondary market trading of tokens prior to redemption." | [Redemption](https://docs.tessera.pe/features/redemption) |
| DeFi use (docs, not terms) | "You can: trade on DEXs (e.g., Meteora on Solana); lend/borrow via DeFi protocols; provide liquidity to earn fees; transfer freely to anyone" | How do T-Tokens Work? |
| Pooled vehicles, wrapping, derivatives | **Silent** in the Terms. | — |

Clauses 3.1(d) and 4.1(c) are the closest any issuer comes to addressing a pooled vault. A Bucket vault PDA holds T-Tokens and moves them on behalf of every bucket-token holder. Each move is a "Tessera Transaction" under 1.15(a). Whether that is "permit[ting] others to … undertake any Tessera Transaction using a … wallet address that you control" is a question for counsel. So is whether a program-derived address is a "wallet" anyone "controls".

### 3.5 Issuer powers

- Redemption only after a Liquidity Event, only during a 90-day window: "'Redemption Period' means the period commencing at 10 am Panama time on the Redemption Start Date and ending at 10 pm Panama time on the 90th day thereafter." (2.2(a)(i)). After it: "that Issuer shall be deemed fully and irrevocably discharged from its obligation to repay that Stablecoin Loan" (2.2(e)). Docs: "Token holders must actively participate in the redemption process during the designated window—redemption is NOT automatic." Redemption is paid in USDC or USDT "as the relevant Issuer may determine in its sole discretion".
- Blacklisting and termination: "TWF may suspend or terminate your rights to access and/or use Tessera at any time for any reason at TWF's sole discretion" (6.1); no liability "including blacklisting any blockchain address you may have used to access Tessera" (6.3).
- Smart contracts are "maintained and modifiable by TWF" (1.14(b)); fees "may be subject to change via variations to the Tessera Smart Contracts" (1.15(d)).
- Issuer substitution by novation, without reissuing tokens (11.7). Already used for T-SpaceX.
- Automated protective actions via Hypernative, "narrowly scoped to the specific threat" ([Threat Monitoring](https://docs.tessera.pe/technicals/threat-monitoring)).
- On-chain (T-OpenAI mint, 21 Sep 2026): mint and transfer-fee authority `EXvTtx…7YW` (Fireblocks, as documented). **Freeze authority is set** (`7n2PNc…Et8o`). The docs' authority table does not mention a freeze authority. No permanent delegate, no pause, no transfer hook. Transfer fee 20 bps.

---

## 4. Side by side

| | xStocks | PreStocks | Tessera |
| --- | --- | --- | --- |
| Entity | Backed Assets (JE) Ltd, Jersey | Not disclosed | TWF (Panama foundation) + one Panama issuer per token; Cayman SPC below |
| Instrument | Tracker certificate (debt security); Swiss ledger-based security | Bearer token referencing exposure; no rights | Unsecured, limited-recourse stablecoin loan |
| Law / forum | Jersey (product), Swiss (ledger); Jersey courts | BVI; LCIA London | Singapore; SIAC |
| Primary market | Professional investors, KYC, $5k min | Not described; redemption needs verification | Anyone not excluded; KYC on request |
| Secondary holders | Deemed reps (read prospectus, JFSC/SPB warning) | Bound by ToS "however and from whomever acquired" | Bound by Terms on any use, incl. Direct Access |
| Pooling / wrapping | Silent | Anticipated, disclaimed, not forbidden | Silent; but 3.1(d)/4.1(c) bar letting others transact through your wallet |
| Freeze | On-chain yes; terms say "future" | Yes | On-chain yes; undocumented |
| Permanent delegate | On-chain yes; not in terms | Yes | No |
| Pause | Yes | Yes | No |
| Transfer fee | None | 1% (changeable without notice) | 0.2% (changeable) |
| Forced exit | Issuer Call Option, ≥30 business days' notice | Compulsory redemption, possibly at nil; post-IPO/M&A conversion deadlines, then worthless | 90-day Redemption Period after exit, then forfeited |
| Restricted list | 4 prohibited + 24 non-serviceable + UK + CH retail + FATF black list | 36 named + sanctions catch-all + licensing catch-all | 14 named + FATF black and grey lists + licensing catch-all |

---

## 5. Can a program-owned vault hold these and issue a token against them?

### What the terms say

1. **None of the three expressly forbids it.** None expressly permits it either.
2. **xStocks** are described as "permissionless" and "freely transferable", and the issuer's own group runs pooled vault products on them. But the product is a regulated security with offering rules in the EEA, UK and Switzerland, a Jersey characterisation that depends on sophisticated investors, and deemed representations from every secondary acquirer. A bucket token is minted and sold to retail users against xStocks held in the vault.
3. **PreStocks** say in terms that their tokens "may be … wrapped, bridged, pooled … by any person … without our … consent", and their FAQ invites people to "build new structured products". They also bind every holder, keep broad powers to freeze, claw back or blocklist any address for any "operational reason", and can add eligibility conditions "retrospectively to existing holders".
4. **Tessera** terms prohibit letting others "undertake any Tessera Activity and/or Tessera Transaction using a Tessera-compatible wallet address that you control" and require holders to redeem within a 90-day window or lose the claim.

### What the terms do not say

- Whether a program address (PDA) with no owner can be a "holder", "User", "Investor" or "Participant" who gives the representations each set of terms requires.
- Who gives those representations for the vault: Bucket as program deployer, the bucket's creator, or each bucket-token holder.
- Whether bucket-token holders, who may buy on any DEX with no Bucket screening, are treated as holding the issuer's token "for the account or benefit of" themselves.
- Whether an issuer would treat a Bucket vault as a distributor, an authorised participant, or neither.
- How corporate actions, conversions, terminations and redemptions that need KYC or an action by the holder are meant to work for a program.

### Questions counsel must answer

**xStocks**
- X1. When a user mints a bucket token that is backed by xStocks in a vault, is Bucket (or the creator) "offering", "distributing", "selling" or "on-selling" xStocks for the purposes of the EU Prospectus Regulation and MiFID II, UK FSMA ss. 19, 21 and 85, and Swiss FinSA art. 70? The Base Prospectus says such activity by others "may trigger regulatory obligations in Switzerland".
- X2. Is a bucket token a new security, structured product, derivative or unit in a collective investment scheme referencing xStocks, needing its own prospectus or a PRIIPs KID in the EEA or UK?
- X3. The Products "may be offered, sold or otherwise delivered at any time only to transferees that are Non-United States Persons". Bucket tokens trade freely on DEXs. Does a US person buying a bucket token on Meteora put the vault's xStocks "for the account or benefit of U.S. Persons"? Is front-end geo-blocking enough, or does Bucket need on-chain controls (allowlist, transfer hook) on the bucket token itself?
- X4. Who gives the deemed secondary-market representations (read the Base Prospectus, received the JFSC and SPB warnings) when the vault acquires xStocks? Must Bucket pass the Base Prospectus, Final Terms and JFSC warnings through to bucket-token buyers, as the JFSC "expects" of Authorised Participants?
- X5. The Offering Terms describe freezing as a possible future feature, but the Solana mints already have a freeze authority and a permanent delegate. What has Backed committed to about using them on Solana, and could they be used against a vault because of who holds bucket tokens?
- X6. After an Issuer Call Option, redemption goes through the issuer with KYC and a $5,000 minimum. A vault cannot do KYC. Is a vault holder that never redeems treated fairly, and does Bucket need a policy to sell before the Termination Date?
- X7. May Bucket show xStocks names and tickers (NVDAx and so on) in its catalog and on bucket pages? May it pull prices and the token list from xstocks.fi, whose terms forbid automated retrieval and commercial use?
- X8. Should Bucket approach Backed for a written consent or integration agreement? Their site invites platforms to "integrate".

**PreStocks**
- P1. The terms bind anyone "acquiring, holding, transferring, or transacting in any token … however and from whomever acquired". Who is "you" when a program holds PreStocks for bucket-token holders? Does Bucket, as deployer, become bound and make the Participant Agreement reps for every holder?
- P2. Given the absence of an identified issuer entity, against whom would the vault or Bucket have any claim? Is it acceptable, from a consumer-protection and suitability view, to put such a token in a product offered to retail users?
- P3. The terms allow PreStocks to "impose … conditions … retrospectively to existing holders" and to freeze or blocklist any address for "operational" reasons. What happens to bucket-token holders if the vault is frozen, and does Bucket owe them a disclosure or a duty beyond the risk disclosure?
- P4. Conversion deadlines: SpaceX PreStocks must be swapped before 12 March 2027 or become worthless. Who in a bucket is responsible for the swap (creator edit, admin edit, keeper)? Is an admin forced edit consistent with the "creator steers the weights" and "nobody can move your money" statements?
- P5. How should Bucket read the sanctions catch-all ("any other jurisdiction subject to sanctions or restrictive measures enforced by … the U.K., or the E.U.")? Country-wide measures only, or every jurisdiction with list-based measures?
- P6. The terms bar "citizens" of Prohibited Jurisdictions, not only residents. Bucket cannot check citizenship without KYC. Is an attestation enough?
- P7. The spec and design say PreStocks are "SPV-backed" or "backed 1:1 by SPV exposure". Given the terms, is that wording misleading? (See `not-shares-notice.md` for a replacement.)
- P8. Given the company statements that SPV transfers of their shares are "void" (Anthropic, OpenAI), should Bucket exclude some PreStocks tokens from the catalog altogether?

**Tessera**
- T1. Does a Bucket vault PDA holding and transferring T-Tokens for many bucket-token holders breach Terms 3.1(d) and 4.1(c)? If so, is a written waiver or agreement from TWF needed before T-Tokens can be in the catalog?
- T2. Does 11.5 (no assignment of rights without consent) affect a bucket token that gives holders an economic interest in T-Tokens held by the vault?
- T3. Redemption: only the holder can redeem, within 90 days of the Redemption Start Date, in a stablecoin chosen by the issuer. Who must act for the vault, and what is Bucket's exposure if the window is missed? T-SpaceX has "entered its redemption event cycle".
- T4. Excluded Jurisdiction item (15) links the June 2025 FATF lists "and such updated list as may be available". Which list governs? Does "People's Republic of China" include Hong Kong and Macau?
- T5. Items (16) and (17) exclude any jurisdiction where Tessera "would be subject of licensing" or is "restricted … in any form". These cannot be enforced without a legal survey. Can Bucket rely on the named list plus FATF lists?
- T6. The docs rely on "a non-security legal opinion under Singapore law". Can Bucket see it? Does it say anything about pooled holding or onward tokenisation?
- T7. The home page says "no geographic restrictions" and the Terms list Excluded Jurisdictions. Bucket should follow the Terms. Please confirm.

**All three**
- A1. Does holding these tokens in a pooled vault that issues its own token change the regulatory character of the issuer's token (for example, turn Bucket into a distributor, arranger or dealer), separately from the fund questions in `counsel-brief.md`?
- A2. Should Bucket seek written confirmation or an integration agreement from each issuer before mainnet? Which issuer is most likely to object, and what would an objection trigger (blocklisting the vault)?
- A3. How do issuer freeze, clawback and permanent-delegate powers interact with the promise in the spec that "A creator can never withdraw, move or redirect a backer's money" and with the design line "can never withdraw, move or redirect your money"? The promise is true of the creator and Bucket, not of the issuers.

---

## 6. Pages fetched, and what failed

| URL | Result |
| --- | --- |
| https://xstocks.fi/ , https://xstocks.com/ | OK |
| https://xstocks.fi/documents/xstocks-terms-of-service.pdf | OK (PDF) |
| https://docs.xstocks.fi/docs/product-legal-overview , /frequently-asked-questions , /issuance-and-redemption , /dividends-and-stock-splits | OK |
| https://assets.backed.fi/legal-documentation and /issuer , /restricted-countries , /notices-to-investors , /service-providers , /product-database | OK |
| https://assets.backed.fi/terms-of-service | Redirects to the ToS PDF dated 18 Nov 2025. OK |
| Base Prospectus PDF (`Backed_Assets_Base Prospectus_20260727.pdf`, document dated 8 May 2026) and First Supplement (27 Jul 2026) | OK. I read the PDF published under the 27 Jul file name; it may be a consolidated version. |
| NVDAx Final Terms (via sppdownloaddocumentservice.l-p-a.com) | OK |
| WBSx termination notice (17 Sep 2026) | OK |
| https://www.kraken.com/legal/xstocks , https://support.kraken.com/articles/xstocks-faq | **Failed**: DNS lookup failed (ENOTFOUND) from both curl and WebFetch. Kraken is a distributor, not the issuer. A search-result summary said Kraken does not offer xStocks in the US, Canada, UK or Australia. **Unverified.** |
| https://prestocks.com/terms | **404** |
| https://url.prestocks.com/terms-of-service → prestocks.notion.site | JavaScript-only page. Read in full through Notion's public `loadPageChunk` API. WebFetch returned an empty page. |
| https://prestocks.com/faq | Questions visible; answers read from the site's JavaScript bundle |
| https://prestocks.com/spacex , https://prestocks.com/api/prestocks | OK |
| https://terms.tessera.pe/ , /disclosures , /terms-and-conditions.md | OK |
| https://docs.tessera.pe/ and the pages linked above (Markdown versions) | OK |
| https://www.fatf-gafi.org/… (June 2026 lists) | **403** from curl and WebFetch. Used the FIAU Malta and MAS restatements instead. |
| https://ofac.treasury.gov/… | OK (used in `geo-restrictions.md`) |
