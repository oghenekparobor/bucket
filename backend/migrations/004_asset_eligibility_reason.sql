-- Why a token is not eligible for new buckets (liquidity floor, flag, issuer event), and the issuer's
-- conversion or redemption deadline when there is one (config/issuer-events.json).
ALTER TABLE assets ADD COLUMN eligibility_reason text;
ALTER TABLE assets ADD COLUMN deadline timestamptz;
