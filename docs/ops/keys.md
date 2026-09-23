# Key register (devnet)

Checklist 0.4: *Create devnet wallets for deployer, keeper, fee payer and platform fees. Document who holds each key.*

All devnet keys were generated on 21 Sept 2026 and live in `keys/`, which is **gitignored** (mode 600). **Holder: the repo owner (Oghenekparobor), on their workstation only.** Nothing here is used on mainnet. Mainnet keys are generated separately under 2.5 (multisig for admin and upgrade authority, managed keeper and fee-payer keys).

| Role | File | Public key | Can do on-chain | Cannot do |
| --- | --- | --- | --- | --- |
| Deployer / admin | `deployer.json` | `7g1TMZKkAxJxsRdzCprZEHAEpZPPhGztjCpu3H3CgFrt` | Program upgrade authority (both programs); `Config.admin`: update params, rotate roles, add/disable assets, `force_price`, forced removal of a delisted token (24h notice) | Move any vault asset |
| Keeper | `keeper.json` | `3QrMgN5zXxuwQW7LAZYFZ5NCnVftvR2o36bFNhMoWs7k` | `fill_mint`, `fill_redeem`, `close_mint_order`, `settle_commission`, `activate_edit`, `rebalance` (vault → vault, toward target) | Move vault assets anywhere but back into the vault or to the redeeming holder (tested in `security.test.ts`) |
| Price authority | `price-authority.json` | `7kzcP2ZtNNtyrSQyYqbEomh4nH5c6TCXMphuutVbEkMQ` | `update_price` (clamped ±20% of TWAP); devnet mock venue prices | Force a price; anything else |
| Fee payer | `fee-payer.json` | `6BpsRspw9BrQd631rVZqJmzXyCDjZUpFVBm8narw2Fme` | Pays network fees and rent for sponsored user transactions | Nothing in the program; it is never a program role |
| Platform fees | `platform-fees.json` | `E9D5dRD7PQDvEDTgqRLsK1V6yquTfbCSgabAUCVmdYwi` | `Config.fee_wallet`: receives the 0.20% USDC mint fee and claims the platform's commission tokens | – |
| Program id: bucket_vault | `bucket_vault.json` | `GwTYDwQh9nCACjBD44EK5qm5QmfWUw1XtF1RfyrigN29` | Only used at first deploy | – |
| Program id: mock_swap | `mock_swap.json` | `AJGUpUhoiae8c3Kyu9Gk4j8f8E7mpyiMqPSf2w3FNRyx` | Only used at first deploy; devnet only | – |

The Solana CLI default wallet (`~/.config/solana/id.json`, `Ht7mqwA9MxZNJJ2CwQaeG622mUxvVbWJHdqijWhoPEY8`) is the owner's personal devnet wallet. It funded the Meteora spike. It is not a Bucket role.

## Separation rules (apply to mainnet too)

- Keeper, price authority and admin are **three different keys**. A compromised keeper cannot move prices; a compromised price authority cannot trade; neither can change config.
- Admin and upgrade authority move to a multisig before mainnet deposits (checklist 2.5); `set_roles` does the on-chain part.
- Each service loads its key from an env var path (`KEEPER_KEYPAIR`, `PRICE_AUTHORITY_KEYPAIR`, `FEE_PAYER_KEYPAIR`), never from the repo.
- Balance alerts: keeper and fee payer must keep enough SOL for fees and rent (backend alerting).

## Rotation

`set_roles(admin, keeper, price_authority, fee_wallet, swap_programs)`, signed by the admin, replaces any role in one transaction. The fee payer is off-chain only: swap the env var.
