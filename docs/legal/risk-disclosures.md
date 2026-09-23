> DRAFT — prepared by an engineering assistant for review by qualified counsel. Not legal advice. Not reviewed.

# Risk disclosures

*Draft for counsel. Plain language on purpose. Facts about issuers are as of 21 September 2026 and come from `issuer-terms.md`. Placeholders are marked `[[COUNSEL: …]]`.*

Putting money into a bucket is risky. **You can lose some or all of it.** Read this before you invest, and only invest money you can afford to lose.

Bucket tokens are not bank deposits. No deposit guarantee, investor compensation scheme or insurance covers them. [[COUNSEL: confirm for each launch country, and name any scheme that does apply.]]

---

## 1. Tokenized stocks are not shares

Public stocks in buckets are **xStocks**, issued by Backed Assets (JE) Limited in Jersey.

- An xStock is a **tracker certificate**: a debt security that follows the price of one share or ETF. It is not the share. You get no votes, and dividends are reinvested into the token rather than paid to you.
- It is backed by real shares held by custodians, with a security agent for holders. If the issuer or a custodian fails, getting value back depends on that structure working. It may be slow, and you may get less.
- xStocks trade around the clock, but the underlying market does not. Outside market hours, prices can drift from the last close and jump at the open.
- Only verified professional investors can create or redeem xStocks directly with the issuer, with a $5,000 minimum. Everyone else, including a bucket's vault, relies on buying and selling them on-chain.
- **The issuer can end an xStock.** It can terminate a product with at least 30 business days' notice, for example after a merger or delisting. Payout then goes through the issuer's redemption process, which a bucket's vault cannot use. Bucket would have to sell that holding on-chain before liquidity dries up, possibly at a worse price. Backed gave termination notices for four xStocks in August and September 2026.
- Splits and dividends are applied by changing a multiplier on the token. If a venue or price feed applies it late or wrongly, prices can look wrong for a while.

## 2. Issuers have powers over the tokens, including those in the vault

Every token in a bucket is issued by someone else. Their terms, and the token code itself, give them powers Bucket cannot override.

| Power | What it can do | xStocks | PreStocks | Tessera |
| --- | --- | --- | --- | --- |
| Permanent delegate | Move or burn tokens from any account, including a bucket's vault | Yes | Yes | No |
| Freeze | Stop a specific account from moving the token | Yes | Yes | Yes |
| Pause | Stop every transfer of the token, everywhere | Yes | Yes | No |
| Transfer fee | Take a cut every time the token moves | None today | **1%** today | **0.2%** today |
| Change fees | Raise transfer fees without notice | — | Yes | Yes |
| Forced redemption or deadline | End the token or make it worthless after a date | Yes (termination) | Yes (compulsory redemption; post-IPO deadline) | Yes (90-day redemption window) |
| Migrate or replace the token | Move to a new token or contract | Yes | Yes | Yes (issuer substitution) |

What this means for you:

- **"Nobody can move your money" is true of the creator and of Bucket. It is not true of the issuers.** An issuer could freeze or claw back a holding in a vault, for example because of sanctions, a court order, or its own view of who holds bucket tokens. Every holder of that bucket would share the loss.
- If an issuer pauses or freezes a token, trades in that token fail. New money cannot fill that leg, and your redemption of that slice waits until it can move. Your claim is recorded, but you may not get it out for some time, or at all.
- **Transfer fees are a real cost.** A PreStocks leg costs about 1% each time it moves: into the vault when you invest, and out when you leave. This is on top of swap costs and Bucket's fees.

## 3. Pre-IPO tokens are riskier still

Buckets can hold tokens linked to private companies, from **PreStocks** and **Tessera**. Each is capped at 25% of a bucket.

### They are not shares

- They give **no ownership, no votes, no dividends and no right to company information.**
- **The companies have not approved them**, and may act against them. In May 2026 Anthropic said any transfer of its shares to a special purpose vehicle is "void", and OpenAI issued a similar warning. The related tokens fell 34–39% in a week.

### PreStocks

- PreStocks tokens are bearer tokens that reference a private company. PreStocks says they are backed through special purpose vehicles (SPVs), but its terms allow the backing to be almost anything: fund interests, derivatives, swaps, other tokens or cash, changed at any time without notice.
- **You have no claim on that backing**, and no claim against PreStocks or any SPV.
- **PreStocks does not publicly name the company that issues its tokens.** Its terms are governed by British Virgin Islands law.
- **After an IPO or acquisition there is a deadline.** Holders must swap into the public-company token within 9 months of an IPO (6 months after a merger opens conversion), or the PreStocks token becomes worthless. **SpaceX has already listed**: SpaceX PreStocks must be swapped before 11:59pm UTC on 12 March 2027. Bucket must do this for every bucket that holds it; if that swap fails, the holding is lost. [[COUNSEL: confirm the process and notice for these forced swaps.]]
- PreStocks can freeze, claw back, burn or compulsorily redeem tokens at a value it chooses, which "may be … in some circumstances nil".

### Tessera

- A Tessera T-Token is an **unsecured loan** to a Panama company set up by Tessera for that one token. That company invests in the private company through a Cayman Islands fund structure.
- The loan is repaid **only** from what that investment returns when the company has an exit (an IPO or a sale). If there is no exit, there is no repayment date.
- **After an exit, holders must redeem within a 90-day window. If nobody redeems in time, the claim is gone for good.** Bucket must do this for the vault. T-SpaceX has entered its redemption cycle; no redemption date had been announced by 28 August 2026. [[COUNSEL: confirm the process.]]
- Each T-Token series is small, around $0.5M of principal.

### Price and mark can be far apart

Issuers publish a "mark price", their estimate of what the private share is worth. The token trades at whatever buyers pay, which can be far away.

- **On 21 September 2026, the SpaceX PreStocks token traded at about $117 while the mark was about $152**, roughly 23% lower, even though SpaceX is now public.
- The same day, Tessera's T-OpenAI traded **above** its mark: about $974 against $813.

Bucket measures returns and commission on the token price, because that is what you can actually trade at. The token price can move a lot on one large order, and it can stay far from the mark for a long time.

## 4. Smart-contract and technology risk

- The Bucket program is new code. [[COUNSEL: state audit status and date, and link the report, before launch.]] A bug could lose money in a vault.
- Buckets also depend on code we do not control: the Solana network, the Token-2022 program, Jupiter (for swaps), Meteora (for pools) and each issuer's token settings.
- Bucket holds admin keys that can change allowed tokens, fee rates and limits, correct prices, and remove a delisted token from buckets. [[COUNSEL: add whether the program can be upgraded and who holds that key.]] A stolen or misused admin key could cause losses.
- Solana can slow down, halt or fork. Transactions can fail and have to be retried.
- If you use the Bucket wallet, you depend on Privy for sign-in and signing. If Privy is down, you can still export your key (while you still have access) and use another wallet.

## 5. Liquidity, slippage and costs

- When you invest through the vault, Bucket buys every holding. Each trade can move the price. Bucket stops any trade that would cost more than **1%** beyond the reference price (plus the issuer's transfer fee for that token), and returns what could not be bought to you in USDC.
- A bucket with 15 holdings may need several transactions to fill. You get tokens as each part completes.
- Some tokens, especially pre-IPO tokens and less-traded stocks, have little liquidity. A large exit can get a much worse price than the unit price shows.
- Very small amounts may be routed to the pool instead of the vault.
- Your total cost is Bucket's 0.20% mint fee, plus swap costs, plus issuer transfer fees, plus price impact. The confirmation screen shows the effective price you get against the unit price.

## 6. Pool price is not unit price

- **Unit price** is what the vault's holdings are worth per bucket token.
- **Pool price** is what the token trades for in its Meteora pool.
- They can differ, especially when the pool is thin. You could pay more than the holdings are worth, or sell for less. The app compares both routes and picks the cheaper one, and shows the premium or discount on every bucket page. If you trade the token elsewhere, nobody does that check for you.

## 7. How commission works, with dollars

The creator earns **20% of the rise in unit price above the bucket's previous high** (its "high-water mark"). Bucket keeps 20% of that commission; the creator gets 80%. Commission is paid by minting new bucket tokens, so it lowers the value of every token a little. It is never charged while the bucket is below its high.

**Example.** You invest $1,000 when the unit price is $100, so you get 10 tokens (Bucket's $2 mint fee and swap costs come on top).

| What happens | Unit price | High-water mark | Your 10 tokens are worth | Commission from your tokens |
| --- | --- | --- | --- | --- |
| You invest | $100 | $100 | $1,000 | — |
| Holdings rise 25% | $125 | $100 | $1,250 before commission | $50 ($40 creator, $10 Bucket) |
| After commission is taken | $120 | $120 | $1,200 | — |
| Holdings fall 10% | $108 | $120 | $1,080 | $0 (below the high) |
| Holdings recover to $130 | $130 | $120 | $1,300 before commission | $20 ($16 creator, $4 Bucket) |
| After commission is taken | $128 | $128 | $1,280 | — |

You end up 28% ahead. You paid $70 in commission in total.

Things to know:

- **Commission already taken is not refunded** if the price falls later.
- **Timing matters.** If you buy while a bucket is below its high, you pay no commission on the climb back to that high. If you buy at the high, you pay on every new gain.
- To stop price manipulation, commission uses the lower of the current price and a 30-minute average for each holding. After a sharp rise, commission catches up over time, so the amount taken on a given day can differ from the simple formula.
- Commission is settled at least once a day and before every investment and exit.

## 8. Price feeds and the keeper

- Bucket's program needs prices for each holding to value the vault for commission and to size new tokens. A dedicated price service pushes those prices on-chain. Public stocks use market feeds; pre-IPO tokens use a time-weighted on-chain trading price, because they have no oracle.
- The program limits how far a price can move in one update (±20% of its recent average). This protects against bad data but means a genuine large move takes time to show.
- If prices are more than an hour old, new investments pause. **Exits do not.**
- An automated keeper completes multi-part investments, settles commission and rebalances vaults after edits. If it stops, investments may stall and a vault may drift from its recipe. Anyone can run these steps, and **redeem never needs the keeper**.
- Bucket's admins can correct a price after a corporate action such as a split. A wrong correction would misprice the bucket until fixed.

## 9. Creators

- A creator is a person with a view, not a licensed manager. [[COUNSEL: adjust once the regulatory analysis of creators is done.]] Their picks can be wrong, concentrated or reckless.
- A creator can change the holdings once every 7 days. You get 24 hours' notice and can leave, but if you miss the notice, your money follows the new recipe.
- A creator could try to profit from their own edit, for example by buying a thin token before adding it. The 24-hour delay, liquidity floor, weight caps and monitoring reduce this but cannot rule it out.
- A creator can stop paying attention. The bucket then keeps its last recipe. You can still exit.
- A creator must keep at least $25 of their own money in the bucket to publish it and stay ranked. That is a small amount compared with what backers may put in.
- A high rank reflects past returns over a chosen period. It is not a measure of skill or safety.

## 10. Regulation can change

- The rules for tokenized stocks, pre-IPO tokens and products like Bucket are unsettled and differ by country. A regulator could decide that Bucket, a bucket, a creator or a token needs a licence or registration.
- If that happens, Bucket may have to block your country, stop new investments, remove tokens or close features. We will always try to keep exit open.
- Issuers change their own country lists. A country can be added at any time, and you may then be unable to invest more.
- [[COUNSEL: add any risk warning the chosen licence, exemption or local marketing rules require, in the required form and wording.]]

## 11. Taxes

Investing, redeeming, selling, commission minting, issuer multipliers, forced swaps and redemptions may all have tax effects for you. Bucket does not give tax advice.

## 12. Creator coins

[[COUNSEL: creator coins are a later feature with their own review. Minimum warning: a creator coin is a separate token, not backed by any bucket's holdings, with no claim on any vault. Its price follows demand only and can go to zero.]]
