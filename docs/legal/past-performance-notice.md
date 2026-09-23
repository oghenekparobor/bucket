> DRAFT — prepared by an engineering assistant for review by qualified counsel. Not legal advice. Not reviewed.

# Past-performance notice

*Where it shows: beside every return figure. That means bucket pages, the leaderboard, creator profiles, share-link preview cards and PnL cards. Placeholders are marked `[[COUNSEL: …]]`.*

## One line (in the app)

This is the line the design already uses on the bucket page, kept as is:

> Past performance is not a promise. Max drawdown for this bucket is {{dd}}. The creator steers weights but can never withdraw, move or redirect your money.

Shorter form, for places without room for drawdown (leaderboard footer, preview cards, PnL cards):

> Past performance is not a promise.

> Note to counsel: the last sentence of the design line is true of the creator. It is not true of the token issuers, who can freeze, move or burn tokens in a vault (see `risk-disclosures.md` §2). Readers may take it to mean nobody can touch their money. Options: keep it and rely on the risk disclosures; or change it to "The creator steers the weights but can never withdraw your money." [[COUNSEL: choose.]]

## Short notice (beside returns, expandable)

> **Past performance is not a promise.** Returns show how this bucket's unit price changed over the period shown, after commission, using the on-chain price of each holding. They say nothing certain about what happens next. Tokenized stocks and pre-IPO tokens can fall fast, and pre-IPO tokens can trade far from the issuer's mark. Max drawdown is the biggest fall from a previous high. Your own return depends on when you bought and what you paid, and is shown separately. Short periods, like 7 days, can make luck look like skill.

## Variants

| Place | Text |
| --- | --- |
| Leaderboard footer | Ranked by past return over the period shown. Past performance is not a promise. A rank is not a recommendation. |
| Creator profile | Every bucket this wallet has made is shown, including closed and losing ones. Past performance is not a promise. |
| PnL card (image) | Past performance is not a promise. bucket.xyz/b/{{slug}} |
| Share preview card | 30-day return, after commission. Past performance is not a promise. |
| Bucket younger than 30 days | This bucket is {{age}} days old. A short record says very little. Past performance is not a promise. |

## Notes for counsel

1. **Prescribed wording and periods.** Some regimes fix the wording and the periods for past performance. For example, if Bucket or a creator counts as an investment firm in the EU, Commission Delegated Regulation (EU) 2017/565, Art. 44(4), requires, as I understand it, performance over the preceding five years (or since inception) in complete 12-month periods, the source and period stated, and a prominent warning that past performance is not a reliable indicator of future results. Bucket shows 7-day, 30-day and 90-day returns and ranks on them. [[COUNSEL: confirm whether any such rule applies in the chosen jurisdictions and, if so, which periods may be shown and the exact warning.]] Not verified against the regulation's text for this draft.
2. **PnL cards and share links are marketing.** A creator or backer posting a PnL card on X may be making a financial promotion in some countries (for example under UK FSMA s. 21). The design hides dollar amounts by default. [[COUNSEL: say whether the card needs more than the one-line notice, and whether the card itself creates liability for Bucket.]]
3. **"Past performance is not a promise"** is the product's voice. The more common regulatory phrase is "Past performance is not a reliable indicator of future results." [[COUNSEL: pick one; if a regime prescribes wording, use it in that regime.]]
4. **Keep the notice next to the number.** It should never be cropped out of a PnL card, hidden behind a tap on the leaderboard, or left off a preview card.
