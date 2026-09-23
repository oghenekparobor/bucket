> DRAFT — prepared by an engineering assistant for review by qualified counsel. Not legal advice. Not reviewed.

# Bucket Terms of Service

*Draft for counsel. Written in the product's plain voice on purpose; counsel should add whatever formal language the chosen law requires. Every placeholder is marked `[[COUNSEL: …]]`. Notes to counsel that are not meant to ship are in blockquotes starting "Note".*

Last updated: [[COUNSEL: date]]

## 1. Who we are

Bucket is run by [[COUNSEL: legal entity name, company number, registered address, country]] ("Bucket", "we", "us"). You can reach us at [[COUNSEL: support email]].

These terms are a contract between you and us. Please read them. By signing in or using Bucket, you agree to them. If you do not agree, do not use Bucket.

These terms include the [Risk disclosures](risk-disclosures.md), the [Privacy notice] [[COUNSEL: privacy notice to be drafted]], and, if you create a bucket, the [Creator terms](creator-terms.md).

## 2. What Bucket is

Bucket is software. It lets people build a bucket: a public, weighted list of tokenized stocks and pre-IPO tokens. Every bucket has its own token.

- **Money going in** buys every holding into the bucket's vault, in the vault's current proportions, and mints bucket tokens to you.
- **Money coming out** burns your bucket tokens and sells your share of every holding for USDC, or gives you the holdings themselves.
- **The vault** is a set of token accounts owned by the Bucket program on Solana. No person holds its keys. The program only moves vault assets to fill mints, pay redemptions, pay commission and rebalance to the bucket's recipe.
- **Bucket tokens** are ordinary Solana tokens. You can hold them in any Solana wallet, send them, and trade them outside Bucket, including in each bucket's Meteora pool.

Bucket prices everything in US dollars. Bucket only ever handles USDC.

## 3. What Bucket is not

- **We do not hold your money or your keys.** Your wallet is yours. The vault is controlled by the program, not by us or by the bucket's creator.
- **We do not give investment advice.** Nothing in the app, including buckets, returns, rankings and creator theses, is a recommendation to you.
- **We do not manage buckets.** Creators choose the recipe. The program carries it out.
- **We are not a broker, bank, exchange or custodian.** [[COUNSEL: confirm or correct each of these statements for the chosen jurisdictions once the regulatory analysis in counsel-brief.md is done. If Bucket needs a licence or exemption, state it here.]]
- **We do not issue the stocks or pre-IPO tokens** in buckets. Other companies do (section 8).

> Note to counsel: "non-custodial" needs care. Bucket does not hold user keys, and neither Bucket nor a creator can withdraw vault assets. But Bucket does hold admin keys that can change the program's `Config` (allowed tokens, fee rates, limits), push prices (`force_price`), and force-remove a delisted token from a bucket with 24 hours' notice. [[COUNSEL: engineering to confirm whether the program is upgradeable and who holds the upgrade authority.]] These powers should be disclosed, and they bear on whether Bucket "controls" customer assets in any jurisdiction.

## 4. Who can use Bucket

You can use Bucket only if all of these are true:

1. You are at least 18, or the age of majority where you live if that is higher, and you can form a binding contract.
2. You are not in, a resident of, or a citizen of a country or region we block. The blocked list is in [[COUNSEL: link to public country list]]. **Buckets that hold pre-IPO tokens block more countries** than other buckets.
3. You are not a U.S. person, and you are not acting for one. [[COUNSEL: define "U.S. person", aligned with Regulation S and with the issuers' definitions.]]
4. You are not on a sanctions list, and you are not owned or controlled by, or acting for, anyone who is.
5. Using Bucket is legal for you where you are.
6. You are using Bucket for yourself, not for someone else. [[COUNSEL: decide whether companies may use Bucket.]]
7. [[COUNSEL: any investor-status test the regulatory analysis requires, for example a sophistication or appropriateness check, or professional-investor status in some countries.]]

You must not use a VPN, proxy or anything else to get around our location checks. We may ask you to confirm your country and citizenship, and we may check your wallet against sanctions lists.

If you stop meeting these conditions, you must stop putting money into buckets. **You can still leave**: redeeming or selling your bucket tokens stays open to you. [[COUNSEL: confirm that exit should remain open for blocked and sanctioned users, or say when it will not.]]

## 5. Your wallet

- When you sign in with email, Google, Apple or X, our sign-in provider, Privy, creates a Solana wallet for you. Its key is split so that neither Privy nor Bucket holds the whole key.
- You can export your key from settings at any time. With it, you can use your wallet and redeem your bucket tokens without Bucket or Privy.
- You can also sign in with your own Solana wallet.
- **You are responsible for your wallet**: your sign-in accounts, your devices and any key you export. If someone else gets your key, they can move your tokens, and we cannot reverse that.
- Blockchain transactions are final. We cannot cancel or refund a transaction once it is confirmed.
- Privy's own terms apply to the wallet it provides. [[COUNSEL: link Privy terms; confirm the user contracts with Privy directly.]]

## 6. How buckets work

The full mechanics are in the app and in the [Risk disclosures](risk-disclosures.md). In short:

- **Unit price** is the vault's value divided by the bucket tokens in supply. It starts at $100. Putting money in or taking it out does not move it.
- **Pool price** is what a bucket token trades for in its Meteora pool. It can be above or below the unit price. When you invest or exit in the app, we quote both routes and use the cheaper one.
- **Edits.** A creator can change a bucket's holdings and weights at most once every 7 days. Every change is shown to everyone for 24 hours before it takes effect, and you are notified. You can exit during that time.
- **Rebalancing.** When an edit takes effect, an automated keeper trades the vault to the new weights, within set limits on price movement. The keeper can only trade between USDC and the bucket's allowed tokens inside the vault. It cannot move money out.
- **Minimum.** You can invest from $1. Small amounts may be routed through the pool instead of the vault.
- **Leaving.** You can redeem or sell any amount at any time. There is no lock-up. Redeem works even if the creator is gone, the pool is empty or the Bucket app is offline, as long as Solana is running and the underlying tokens can be transferred (see section 8).
- **Delisted tokens.** If a token stops being available or safe to hold, we may remove it from every bucket that holds it, with the same 24-hour notice as an edit, or sooner if the issuer's own deadline requires it. [[COUNSEL: confirm this admin power and the notice period, including for issuer conversion and redemption deadlines described in the risk disclosures.]]

## 7. Fees

| Fee | Amount | Who gets it |
| --- | --- | --- |
| Mint fee | 0.20% of the USD value you put in through the vault | Bucket |
| Commission | 20% of the rise in unit price above the bucket's previous high, taken across all tokens in supply | 80% to the creator, 20% to Bucket |
| Exit fee | None [[COUNSEL: the product spec proposes a 0.20% fee on redemptions; the current build and design charge none. Confirm before launch.]] | — |
| Management fee | None | — |
| Network fees | Paid by Bucket for transactions in the app [[COUNSEL: product has not decided whether sponsorship is capped; add any cap here]] | — |
| Token account rent | About 0.002 SOL, charged once in USDC when you first get a bucket token, refunded if you close the account | Returned to you on close |

**How commission works.** Commission is only taken when the unit price goes above its previous high (the "high-water mark"). It is paid by minting new bucket tokens, which slightly reduces the value of every existing token. It is never taken while the bucket is below its high, and it is not refunded if the price later falls. Commission is settled at least daily and before every mint and redeem.

**Example.** You put in $500 at a unit price of $100, so you hold 5 tokens. The bucket's holdings rise 20%, taking the unit price to $120. The gain on your tokens is $100. Commission is 20% of that, $20, taken by minting new tokens: $16 goes to the creator and $4 to Bucket. Your 5 tokens are then worth $580, a gain of $80. The $1 mint fee and swap costs come on top.

**Other costs you pay that are not Bucket fees:**
- **Swap costs and price impact** on every trade the vault makes for you.
- **Issuer transfer fees.** Some issuers charge a fee each time their token moves. On 21 September 2026 PreStocks charged 1% and Tessera 0.2% per transfer. Issuers can change these at any time without notice.
- **Pool fees** when you trade in a Meteora pool.

We may change our fees. We will give at least [[COUNSEL: notice period]] notice in the app before a fee increase takes effect. [[COUNSEL: the commission rate and split are also stored on-chain; state whether changes apply to existing buckets.]]

## 8. The tokens in buckets are issued by others

Buckets hold tokens issued by third parties, not by Bucket:

- **xStocks**, issued by Backed Assets (JE) Limited (Jersey): tracker certificates that follow the price of a public share or ETF.
- **PreStocks**: tokens referencing economic exposure to private companies. PreStocks does not publicly identify its issuing entity.
- **Tessera T-Tokens**, issued by Panama subsidiaries of Tessera Works Foundation: unsecured loans repaid only from the proceeds of a company exit.

Their terms apply to those tokens, and they give the issuers powers over them, including in the bucket's vault. Depending on the issuer, they can freeze tokens, move or burn them, pause all transfers, change transfer fees, force a redemption, or set a deadline after which a token becomes worthless. **We cannot stop an issuer from using these powers**, and we are not responsible for what issuers do. See the [Risk disclosures](risk-disclosures.md).

[[COUNSEL: decide whether users must accept each issuer's terms, and how. PreStocks' terms say they bind anyone "acquiring, holding, transferring, or transacting in any token … however and from whomever acquired". See issuer-terms.md.]]

**Pre-IPO tokens are not shares.** They give no ownership, votes, dividends or information rights in the company. The company has not approved them and may object to them.

## 9. No advice, no promises

- Buckets, theses, returns, rankings, PnL cards and notifications are information, not advice. They are not tailored to you.
- **Past performance is not a promise.** A bucket's past return says nothing certain about its future.
- Creators are independent. They are not our employees, agents or advisers, and we do not check their theses. [[COUNSEL: confirm this framing is consistent with the regulatory analysis of creators.]]
- Decide for yourself, and get independent advice if you need it. Only invest money you can afford to lose.

## 10. Creators

If you create a bucket, the [Creator terms](creator-terms.md) also apply to you. They cover your stake, your commission and the rules you must follow.

## 11. Things you must not do

- Break any law, including sanctions, anti-money-laundering and securities laws.
- Get around our location, eligibility or sanctions checks.
- Use Bucket for someone who is not allowed to use it.
- Manipulate prices: pump a thin token before a bucket buys it, trade against a bucket's pending edit, wash trade, or push a price near a commission settlement.
- Spread false or misleading claims about a bucket, a creator, a token or Bucket.
- Impersonate anyone, or claim a link with a company, issuer or person you do not have.
- Attack, overload or exploit the app, the program or the pools, or abuse a bug instead of reporting it.
- Scrape or copy the app at scale. [[COUNSEL: carve out public on-chain data.]]

## 12. What we can do

We can, at our discretion:

- Block or limit your access to the app, or to investing, creating or editing, if we think you have broken these terms or the law, or if we must for legal reasons.
- Hide a bucket from the leaderboard or delist it (see the Creator terms).
- Remove a token from the catalog and from buckets that hold it (section 6).
- Change or stop any part of the app.

What we **cannot** do: take the tokens in your wallet, move a bucket's vault assets anywhere but to fill mints, pay redemptions, pay commission or rebalance, or stop you redeeming on-chain. [[COUNSEL: confirm against the program's final admin powers.]]

## 13. Creator coins

[[COUNSEL: creator coins are a later feature (P1) with their own legal review. Terms to be added before launch. Minimum content: a creator coin is a separate token, not backed by any bucket's holdings, gives no claim on any vault, and its price follows demand only.]]

## 14. Taxes

You are responsible for your own taxes. Minting, redeeming, selling, receiving commission tokens and some corporate actions may all be taxable. We do not give tax advice. [[COUNSEL: add any reporting Bucket must do, for example under DAC8 or CARF, once the entity's home is known.]]

## 15. Changes to these terms

We may update these terms. If a change matters, we will tell you in the app at least [[COUNSEL: notice period]] before it takes effect. If you keep using Bucket after that, the new terms apply. If you do not agree, stop using Bucket; you can still exit.

## 16. Liability

[[COUNSEL: disclaimer of warranties ("as is"), exclusion of indirect and consequential loss, cap on liability, and carve-outs that local consumer law requires (for example fraud, gross negligence, death or personal injury). Keep the plain-language summary below if the chosen law allows it.]]

In plain words: Bucket is new software on a public blockchain, holding tokens from other issuers. Things can go wrong that we cannot control. [[COUNSEL: summary of the cap.]]

## 17. Indemnity

[[COUNSEL: user indemnity for breach of these terms and of law, if enforceable against consumers in the chosen jurisdictions.]]

## 18. Law and disputes

[[COUNSEL: governing law; courts or arbitration; seat; class-action waiver if enforceable; consumer carve-outs; informal resolution step first.]]

## 19. General

[[COUNSEL: entire agreement, severability, assignment, no waiver, language, notices.]]

## 20. Contact

[[COUNSEL: support email, postal address, complaints process and any regulator contact the chosen licence or exemption requires.]]
