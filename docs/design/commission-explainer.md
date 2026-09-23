# How the 20% works — plain-language explainer

Checklist 1.4: *A plain-language explainer for the high-water-mark commission, tested on five people who do not know what one is.*

Status: **explainer written; not yet tested with people.** The test script is below. It needs five real people and cannot be done by software.

## The explainer (as shown in the app)

**Short (invest sheet, bucket page):**
> No entry fee, no management fee. The creator earns 20% of any rise in the bucket above its previous high, paid in new bucket tokens. While the bucket is below that high, nothing is charged.

**With your numbers (confirmation sheet; the app fills in the amounts):**
> You put in $500. If the bucket rises 20%, your $500 becomes $600. The creator's share is 20% of the $100 gain: $20. You keep $580.
> If the bucket then falls to $540 and climbs back to $600, you pay nothing on the climb back. You already paid on the way up the first time.

**"Why do my tokens not change?" (bucket page, expandable):**
> Commission is not taken from your wallet. The bucket mints a few new tokens for the creator, which makes every token in the bucket, yours included, worth slightly less. The effect is the same as paying 20% of the gain, but nothing is ever sold and you never receive a bill.

**Where the numbers come from (for the curious):**
> The bucket keeps a high-water mark: the highest unit price it has already paid commission on. It starts at $100. Commission is only ever 20% of the distance above that mark, and the mark then moves up. Everything is computed on-chain from the vault's holdings and prices, so anyone can check it.

## Five-person test (Design runs this)

Participants: five people who have never heard of a high-water mark or a performance fee. At least two should not invest at all today.

For each person, show the short and "with your numbers" versions on a phone. Then ask, without helping:

1. "You put in $1,000 and the bucket goes up 10%. How much does the creator get?" (expected: $20)
2. "The bucket then drops back to where you started. Do you get that $20 back?" (expected: no)
3. "It climbs back up the same 10% again. Does the creator get paid again?" (expected: no, not until it passes the previous high)
4. "If the bucket never goes up, what do you pay?" (expected: only the 0.20% mint fee; no commission)
5. "Where does the creator's money come from?" (expected: new tokens / a small dilution. "From my wallet" is a miss)

Pass: at least 4 of 5 people answer questions 1–4 correctly. Record every answer verbatim and revise the copy on any question that 2 or more people miss.

| # | Person (initials, investing experience) | Q1 | Q2 | Q3 | Q4 | Q5 | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |
| 4 | | | | | | | |
| 5 | | | | | | | |
