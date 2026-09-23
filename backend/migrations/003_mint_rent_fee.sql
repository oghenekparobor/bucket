-- open_mint's rent_fee_e6: USDC the backer repays for a bucket-token account the Bucket fee payer
-- created for them (capped on-chain at $1). Charged on top of amount_e6 and treated as a fee in cost basis.
ALTER TABLE mint_orders ADD COLUMN rent_fee_e6 numeric(38,0) NOT NULL DEFAULT 0;
