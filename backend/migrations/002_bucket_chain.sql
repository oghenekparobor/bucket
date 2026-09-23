-- Per-bucket chain metadata the API records when it builds the publish transactions (primary data,
-- kept across rebuilds): the bucket's address lookup table, needed by open_mint, redeem and fills once
-- a bucket has more than a handful of holdings.
CREATE TABLE bucket_chain (
  bucket       text PRIMARY KEY,
  lookup_table text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
