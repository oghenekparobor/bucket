> DRAFT — prepared by an engineering assistant for review by qualified counsel. Not legal advice. Not reviewed.

# Creator terms

*Draft for counsel. These apply on top of the Terms of Service when someone publishes a bucket. Placeholders are marked `[[COUNSEL: …]]`. Notes to counsel that are not meant to ship are in blockquotes starting "Note".*

> Note to counsel: the whole shape of these terms depends on the answer to the second regulatory question in `counsel-brief.md`: is a creator who steers a bucket's weights and earns a 20% performance commission acting as an investment adviser or portfolio manager? If yes in a launch country, these terms cannot fix that; the product has to change there (for example, no commission, or licensed creators only). The draft below assumes counsel finds a workable position.

## 1. What being a creator means

When you publish a bucket, you choose its holdings and weights, write its thesis, and put in your own money. Other people can then put money into the same bucket. You earn a commission when the bucket makes new highs.

You are not our employee, agent or partner, and you are not giving advice on our behalf. [[COUNSEL: confirm; add any statement the chosen regime requires about the creator's status, e.g. "you are not authorised to give investment advice".]]

## 2. Who can create

- Everything in section 4 of the Terms of Service ("Who can use Bucket"), plus:
- You are not in a country where creating a bucket, or earning commission from other people's money, needs a licence you do not hold. [[COUNSEL: list the countries where creators are blocked, if different from the investor list.]]
- [[COUNSEL: decide whether creators must verify identity (KYC) before they can claim commission, for tax reporting and sanctions. Product currently only offers an optional verified X link.]]
- One wallet can have at most 5 active public buckets. Using several wallets to get around this is not allowed (section 5).

## 3. Your stake

- You must put in at least **$25** of your own money when you publish.
- You must keep at least $25 in the bucket, continuously, for it to appear on the leaderboard. If you drop below, the bucket stays live but is unranked.
- Your stake is treated exactly like every other holder's: same unit price, same commission, same right to exit. It is visible to everyone.

## 4. Your commission

- **Rate:** 20% of the rise in the bucket's unit price above its previous high (the high-water mark), across all tokens in supply. Fixed for every bucket. You cannot change it.
- **Split:** Bucket keeps 20% of each commission. You get 80%.
- **Paid in bucket tokens**, minted by the program into a fee account for your bucket. You can claim them to your wallet, then hold, redeem or sell them like any other holder.
- **When:** settled at least daily and before every mint and redeem. Nothing is taken while the bucket is below its high.
- **No clawback by us, no refund to backers.** If the unit price later falls, commission already taken stays taken. [[COUNSEL: decide whether Bucket needs the right to withhold unclaimed commission after a breach of section 5. The program today lets the creator claim freely; a withholding right needs an engineering change.]]
- **Example.** A bucket holds $100,000 at a unit price of $100. Its holdings rise 25%. Commission is 20% of the $25,000 rise, $5,000: $4,000 to you, $1,000 to Bucket, paid in new tokens. The unit price becomes $120, the new high. If the price then falls to $108 and recovers to $130, the next commission is on the rise from $120 to $130 only.
- **Taxes on commission are yours.** [[COUNSEL: note any reporting Bucket must do about creator income.]]

## 5. Conduct rules

Break these and we may delist your bucket (section 7).

**Trading around your own edits**

1. Do not trade a token you are adding to or removing from your bucket, directly or through anyone else, from [[COUNSEL: 7 days]] before you propose the edit until [[COUNSEL: 24 hours]] after the rebalance completes. This includes buying before you add a token and selling into the bucket's buying.
2. Do not trade your bucket's own token against backers because you know an edit is coming, before the edit is public.
3. Do not try to move a holding's price around a commission settlement.
4. Do not tell anyone about an edit before you propose it, except to say publicly that you plan one.

> Note to counsel: Bucket can see the creator's known wallets on-chain but not other wallets or off-chain accounts. The spec plans "monitoring of creator wallet trades around edits". The rule above is only as strong as that monitoring and the right to delist.

**Honest claims**

5. Do not promise or imply returns ("guaranteed", "can't lose", "risk-free", price targets presented as fact).
6. Do not show performance that is not the bucket's real, on-chain performance, and do not crop the past-performance notice off a PnL card.
7. Do not say or imply that Bucket, an issuer, or a company in your bucket endorses you or your bucket.
8. Do not impersonate anyone, and do not use a name or thesis that could be mistaken for a company, issuer or fund.
9. Describe pre-IPO tokens as what they are. Do not call them shares or say they give ownership.
10. Do not describe the creator coin (when it exists) as backed by the bucket or as a share of it.

**Conflicts**

11. **Disclose, in your bucket's thesis or a pinned note, if:**
    - you hold, or plan to trade, a holding of the bucket outside the bucket in a size that matters [[COUNSEL: define threshold]];
    - you are paid, sponsored or given anything by a company, issuer, fund or promoter connected to a holding;
    - you work for, advise, or are closely connected to a company in the bucket or to one of the issuers.
12. When you promote your bucket on social media or elsewhere, say that you earn commission from it.

**Fair play**

13. Do not use several wallets, or friends' wallets, to get around the 5-bucket limit, to create fake backers, or to push a bucket up the leaderboard.
14. Do not wash-trade your bucket token or pay people to back your bucket.
15. Do not coordinate with others to pump a holding before your bucket buys it or dump it on your backers.

**Where you promote**

16. You are responsible for following the rules on promoting investments where you and your audience are. [[COUNSEL: add a plain summary for key launch countries, e.g. UK financial-promotion rules and EU "finfluencer" guidance, and say whether Bucket's share links or cards must carry specific wording.]]

## 6. Edits

- You can change holdings and weights at most once every 7 days, within the same rules as creation (2 to 15 tokens, 2% to 50% each, 25% maximum for a pre-IPO token).
- Every edit is public for 24 hours before it takes effect, and every backer is notified. Backers can exit during that time.
- History is permanent. You cannot delete or reset your bucket's performance or version history.
- **Forced edits.** If a token is removed from the catalog, is terminated by its issuer, or reaches a conversion or redemption deadline, Bucket may remove it from your bucket or swap it into its successor with the same 24-hour notice, or less if the issuer's deadline requires. [[COUNSEL: confirm this power and its notice period.]]

## 7. What gets a bucket delisted

**Delisted** means: removed from the leaderboard and discovery, marked as delisted on its page, and closed to new money through the app. **Backers can always exit.** Delisting does not touch anyone's tokens.

We may delist a bucket, with or without notice, if:

1. You break a conduct rule in section 5.
2. You or a linked wallet appear on a sanctions list, or you become ineligible under the Terms of Service.
3. The bucket's name, thesis or notes are misleading, abusive, infringe someone's rights, or break the law.
4. We are required to by law, a regulator, a court, or an issuer's instruction. [[COUNSEL: confirm the issuer-instruction trigger.]]
5. We reasonably believe the bucket is being used for manipulation, fraud or money laundering.

We may also **hide a bucket from the leaderboard** without delisting it if it fails an eligibility rule (age under 14 days, stake under $25, a holding below the liquidity floor, closed).

You can close your own bucket at any time. Closing stops new money; history stays visible and backers can still exit.

What happens to unclaimed commission after a delisting: [[COUNSEL: see section 4; currently nothing, because the program pays it out regardless.]]

> Note to counsel: "closed to new money" for a delisted bucket needs an admin close in the program. Today only the creator can call `close_bucket`. The app can block new money through the front end, but not on-chain mints by other means. [[COUNSEL: decide whether an on-chain admin close is needed.]]

## 8. Your content

You keep your rights in your thesis and notes. You let us show them, and let anyone share them through Bucket's links and cards, for as long as the bucket exists. [[COUNSEL: licence terms.]]

## 9. Creator coins

[[COUNSEL: later feature (P1) with its own review. At minimum: one coin per bucket once it is leaderboard-eligible; the coin is not backed by the bucket; trading-fee split between Bucket and the creator (50/50 proposed); no promise of buybacks; the creator must not describe it as an investment in the bucket.]]

## 10. Changes

We may change these terms with [[COUNSEL: notice period]] notice. Changes to the commission rate or split will not apply to commission already taken. [[COUNSEL: say whether they apply to existing buckets.]]
