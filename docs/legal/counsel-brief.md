> DRAFT — prepared by an engineering assistant for review by qualified counsel. Not legal advice. Not reviewed.

# Counsel brief: Bucket

*For engaging counsel with tokenized-securities and fund experience (checklist 0.2). Two pages. Detail is in the other files in this folder. Facts as of 21 September 2026.*

## The product in five bullets

1. **Buckets.** Anyone can publish a public, weighted list of 2 to 15 tokens: tokenized public stocks (xStocks, by Backed Assets (JE) Ltd) and private-company tokens (PreStocks; Tessera T-Tokens). Pre-IPO tokens are capped at 25% of a bucket.
2. **A pooled vault with its own token.** Money going in buys every holding into a vault owned by a Solana program and mints a bucket token. Bucket tokens are freely transferable, trade in a public Meteora pool, and can be redeemed at any time for a pro-rata share of the vault. Minimum $1. Retail users worldwide, except blocked countries.
3. **The creator steers, the program executes.** The creator picks and edits the weights (once per 7 days, 24-hour public notice). A keeper rebalances the vault automatically. Neither the creator nor Bucket can withdraw vault assets. Bucket holds admin keys over configuration, prices and forced removal of delisted tokens.
4. **Fees.** Creator earns 20% of gains above a high-water mark, paid in newly minted bucket tokens; Bucket keeps 20% of that. Bucket also charges 0.20% on mints. A leaderboard ranks buckets by return, and creators share PnL cards on social media.
5. **Non-custodial wallets.** Users sign in through Privy and get a self-custodial embedded wallet with key export. Bucket handles only USDC; card and bank funding go through Privy's providers. Later (P1): each bucket can launch an unbacked "creator coin" on a bonding curve, with trading fees split between Bucket and the creator.

Bucket's operating entity and home jurisdiction are **not yet decided**. That choice depends on your advice.

## The three regulatory questions (from the spec)

1. **Collective investment scheme.** A program-owned vault that pools many people's money, buys assets according to someone else's choices, and issues a redeemable token against them is a fund in structure. Is it a collective investment scheme, AIF, investment fund or similar in each target jurisdiction? If so, who is the operator or manager (Bucket, the creator, or nobody), and what licence or exemption could apply? Is the bucket token itself a security, structured product or fund unit needing a prospectus or KID (e.g. EU Prospectus Regulation, PRIIPs)? Does seeding and listing each bucket's pool make Bucket a trading venue operator?
2. **Creator as adviser or manager.** A creator chooses and changes the portfolio for other people's money, the program executes automatically, and the creator earns a 20% performance fee. Is that discretionary portfolio management, investment advice, or fund management in each jurisdiction? Are performance fees allowed for retail? Does Bucket's 20% share make Bucket a party to that activity? Do creator promotions (X posts, PnL cards) fall under financial-promotion or "finfluencer" rules?
3. **Creator coin as a security.** An unbacked token per bucket, sold on a bonding curve, with trading fees shared by Bucket and the creator, and a proposed buyback funded by commission. Is it a security, investment contract, financial instrument, or a crypto-asset under MiCA or equivalent? Does the buyback idea change the answer? (P1; may be deferred.)

## Jurisdictions to consider

- **Where Bucket and its operators sit.** Not decided. Your recommendation is part of the ask.
- **Where users are.** Markets the issuers allow (see `geo-restrictions.md`): the EEA (minus Bulgaria for pre-IPO buckets), Latin America, parts of Asia, the Middle East and Africa. Already blocked for some or all buckets: US, UK, Swiss retail, Singapore, mainland China. Kraken's own xStocks vault also excludes Canada, Australia, India, UAE, Kazakhstan, New Zealand and Hong Kong. We would like a short list of the three to five best first markets.
- **The US, even though blocked.** Bucket tokens trade freely on Solana. US persons could buy them on DEXs without touching the app. Does that create US exposure (Securities Act and Regulation S, Investment Company Act, Advisers Act, CFTC) for Bucket or creators, and is front-end blocking enough?
- **Issuer home laws** that govern the underlying tokens: Jersey and Switzerland (xStocks), British Virgin Islands (PreStocks terms), Panama, Cayman Islands and Singapore (Tessera).

## Issuer-terms questions

Full list, with quotes, in `issuer-terms.md` §5. The ones that could block launch:

- **None of the three issuers expressly permits or forbids a program-owned vault that holds their tokens and issues a token against them.** Should Bucket get written consent or an integration agreement from each before mainnet?
- **xStocks** are securities with offering rules in the EEA, UK and Switzerland, and every secondary buyer is deemed to have read the prospectus and received Jersey investor warnings. Is minting a bucket token against xStocks an "offer", "distribution" or "on-sale" of xStocks? Must those warnings pass through to bucket-token buyers?
- **Tessera's terms** forbid letting others "undertake any Tessera Activity and/or Tessera Transaction using a Tessera-compatible wallet address that you control" (4.1(c)). Does a pooled vault breach that?
- **PreStocks' terms** bind anyone holding the token "however and from whomever acquired", the issuing entity is not identified, and PreStocks can freeze, claw back or blocklist any address for "operational" reasons and add conditions "retrospectively to existing holders". Is it appropriate to offer these to retail through a pooled product at all?
- **Issuer powers vs. our promise.** All three can freeze; xStocks and PreStocks can move tokens out of any account (permanent delegate) and pause. The spec says "A creator can never withdraw, move or redirect a backer's money". How should this be disclosed?
- **Deadlines a program must meet.** SpaceX PreStocks must be swapped before 12 March 2027 or become worthless; Tessera claims lapse 90 days after a Redemption Start Date; terminated xStocks are redeemed only through KYC. Who is responsible for acting for the vault, and what is Bucket's liability if it misses one?

## What Bucket needs from you, in writing

From checklist 0.2 (before building past Phase 0), and 2.7 (before mainnet):

| # | Output | Draft in this folder |
| --- | --- | --- |
| 1 | A written view on the pooled vault: which jurisdictions Bucket can serve, and what licence or exemption applies | — (questions above) |
| 2 | A written view on creators earning a 20% performance commission | `creator-terms.md` assumes a workable answer |
| 3 | Confirmation, from the xStocks, PreStocks and Tessera terms, that a program-owned vault may hold their tokens and issue a token against them, or what agreements are needed | `issuer-terms.md` |
| 4 | An approved geo-restriction list built from the strictest issuer list, including whether pre-IPO buckets need a tighter list | `geo-restrictions.md` (two-tier list with JSON) |
| 5 | Reviewed Terms of Service, risk disclosures, past-performance notice, and "pre-IPO tokens are not shares" wording | `terms-of-service.md`, `risk-disclosures.md`, `past-performance-notice.md`, `not-shares-notice.md` |
| 6 | Before mainnet: creator terms (commission, conduct, delisting), and written sign-off to launch in the chosen jurisdictions | `creator-terms.md` |
| 7 | Before P1: a separate view on creator coins | — |

The Phase 0 exit gate requires that counsel "has not said 'do not build this'". An early read on whether any of the three questions is a hard stop in every likely market would let the team decide how far to build before the full opinions arrive.

## Also worth knowing

- Redeem is permissionless and does not depend on Bucket's app, keeper or servers. Creator commission is paid by the program automatically; Bucket cannot currently withhold it.
- Design copy to review: the creator "can never withdraw, move or redirect your money", PreStocks described as "SPV-backed", and a confirmation sheet with no 0.20% mint-fee line.
