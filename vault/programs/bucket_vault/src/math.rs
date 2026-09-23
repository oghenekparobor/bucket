//! Pure arithmetic shared by the instructions. Everything is integer math on
//! u128 intermediates; rounding always favours the vault (existing holders).

use crate::state::{BPS, ONE_TOKEN};

/// USD value (micro-dollars) of `qty` raw units at `price_e6` per whole token.
pub fn value_e6(qty: u64, price_e6: u64, decimals: u8) -> u128 {
    qty as u128 * price_e6 as u128 / 10u128.pow(decimals as u32)
}

/// Micro-dollars per whole bucket token.
pub fn unit_price_e6(value_e6: u128, supply: u64) -> u64 {
    if supply == 0 {
        return 0;
    }
    (value_e6 * ONE_TOKEN as u128 / supply as u128) as u64
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Commission {
    pub commission_e6: u64,
    pub fee_tokens: u64,
    pub hwm_after_e6: u64,
}

/// High-water-mark commission. With U = V/S above H:
/// C = rate × (U − H) × S, paid by minting F = C × S / (V − C) new tokens so
/// that the fee tokens are worth exactly C afterwards. H moves to V / (S + F).
pub fn commission(value_e6: u128, supply: u64, hwm_e6: u64, commission_bps: u16) -> Option<Commission> {
    if supply == 0 || commission_bps == 0 {
        return None;
    }
    let unit = unit_price_e6(value_e6, supply);
    if unit <= hwm_e6 {
        return None;
    }
    let excess_e6 = (unit - hwm_e6) as u128 * supply as u128 / ONE_TOKEN as u128;
    let c = excess_e6 * commission_bps as u128 / BPS as u128;
    if c == 0 || c >= value_e6 {
        return None;
    }
    let fee_tokens = c * supply as u128 / (value_e6 - c);
    if fee_tokens == 0 {
        return None;
    }
    let new_supply = supply as u128 + fee_tokens;
    let hwm_after = value_e6 * ONE_TOKEN as u128 / new_supply;
    Some(Commission {
        commission_e6: c as u64,
        fee_tokens: fee_tokens as u64,
        hwm_after_e6: hwm_after as u64,
    })
}

/// (creator, platform) split of commission tokens.
pub fn split_fee(fee_tokens: u64, platform_share_bps: u16) -> (u64, u64) {
    let platform = (fee_tokens as u128 * platform_share_bps as u128 / BPS as u128) as u64;
    (fee_tokens - platform, platform)
}

/// Split `total` in proportion to `weights`. Rounding remainder goes to the
/// largest weight, so the parts always sum to `total`.
pub fn split_proportional(total: u64, weights: &[u128]) -> Vec<u64> {
    let sum: u128 = weights.iter().sum();
    if sum == 0 {
        return vec![0; weights.len()];
    }
    let mut parts: Vec<u64> = weights
        .iter()
        .map(|w| (total as u128 * w / sum) as u64)
        .collect();
    let assigned: u64 = parts.iter().sum();
    if let Some((i, _)) = weights.iter().enumerate().max_by_key(|(_, w)| **w) {
        parts[i] += total - assigned;
    }
    parts
}

/// Bucket tokens issued for one filled mint leg: the value added at the
/// order's reference price, never more than the USDC actually spent, divided
/// by the order's unit price. The backer bears swap costs; existing holders
/// can never be diluted by a stale-high reference price.
pub fn mint_tokens(qty: u64, price_e6: u64, decimals: u8, spent_e6: u64, unit_price_e6: u64) -> u64 {
    if unit_price_e6 == 0 {
        return 0;
    }
    let value = value_e6(qty, price_e6, decimals).min(spent_e6 as u128);
    (value * ONE_TOKEN as u128 / unit_price_e6 as u128) as u64
}

/// True when `value_out` is no worse than `value_in` less `allowed_bps`.
pub fn within_slippage(value_out_e6: u128, value_in_e6: u128, allowed_bps: u64) -> bool {
    let allowed = allowed_bps.min(BPS);
    value_out_e6 * BPS as u128 >= value_in_e6 * (BPS - allowed) as u128
}

/// Pro-rata quantity of one holding owed for burning `burn` of `supply` tokens.
pub fn redeem_qty(available: u64, burn: u64, supply: u64) -> u64 {
    if supply == 0 {
        return 0;
    }
    (available as u128 * burn as u128 / supply as u128) as u64
}

/// Clamp a pushed price to within `max_move_bps` of the TWAP.
pub fn clamp_price(price_e6: u64, twap_e6: u64, max_move_bps: u16) -> (u64, bool) {
    if twap_e6 == 0 || max_move_bps == 0 {
        return (price_e6, false);
    }
    let band = twap_e6 as u128 * max_move_bps as u128 / BPS as u128;
    let lo = (twap_e6 as u128).saturating_sub(band) as u64;
    let hi = (twap_e6 as u128 + band).min(u64::MAX as u128) as u64;
    if price_e6 < lo {
        (lo, true)
    } else if price_e6 > hi {
        (hi, true)
    } else {
        (price_e6, false)
    }
}

/// Time-weighted average that moves toward the new price in proportion to the
/// time elapsed since the last update, capped at one full window.
pub fn twap_update(twap_e6: u64, price_e6: u64, elapsed_secs: i64, window_secs: i64) -> u64 {
    if twap_e6 == 0 || window_secs <= 0 {
        return price_e6;
    }
    let dt = elapsed_secs.clamp(0, window_secs) as i128;
    let twap = twap_e6 as i128;
    (twap + (price_e6 as i128 - twap) * dt / window_secs as i128) as u64
}

/// Rescale weights (bps) so they sum to 100% in whole percentages, using the
/// largest-remainder method. Used when a forced removal drops a holding.
pub fn renormalize_percent(weights_bps: &[u16]) -> Vec<u16> {
    let total: u64 = weights_bps.iter().map(|&w| w as u64).sum();
    if total == 0 {
        return vec![0; weights_bps.len()];
    }
    let exact: Vec<u64> = weights_bps.iter().map(|&w| w as u64 * 100 * 1_000 / total).collect();
    let mut pct: Vec<u64> = exact.iter().map(|e| e / 1_000).collect();
    let mut left = 100 - pct.iter().sum::<u64>();
    let mut order: Vec<usize> = (0..pct.len()).collect();
    order.sort_by_key(|&i| std::cmp::Reverse(exact[i] % 1_000));
    for &i in order.iter().cycle() {
        if left == 0 {
            break;
        }
        pct[i] += 1;
        left -= 1;
    }
    pct.iter().map(|p| (p * 100) as u16).collect()
}

/// Clamp whole-percent weights (bps) to per-holding caps (bps) and hand the
/// overflow, 1% at a time, to the largest holdings that still have room.
/// None when there is not enough room under the caps to reach 100%.
pub fn cap_weights(weights_bps: &[u16], caps_bps: &[u16]) -> Option<Vec<u16>> {
    let mut w = weights_bps.to_vec();
    let mut overflow: u32 = 0;
    for (x, &cap) in w.iter_mut().zip(caps_bps) {
        if *x > cap {
            overflow += (*x - cap) as u32;
            *x = cap;
        }
    }
    while overflow > 0 {
        let i = (0..w.len()).filter(|&i| w[i] + 100 <= caps_bps[i]).max_by_key(|&i| w[i])?;
        w[i] += 100;
        overflow = overflow.saturating_sub(100);
    }
    Some(w)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caps_redistribute_overflow() {
        assert_eq!(cap_weights(&[5_300, 4_700], &[5_000, 5_000]), Some(vec![5_000, 5_000]));
        assert_eq!(cap_weights(&[4_000, 3_000, 3_000], &[5_000, 2_500, 5_000]), Some(vec![4_500, 2_500, 3_000]));
        assert_eq!(cap_weights(&[10_000], &[5_000]), None);
        assert_eq!(cap_weights(&[3_000, 7_000], &[5_000, 2_500]), None);
    }

    #[test]
    fn renormalize_to_whole_percent() {
        assert_eq!(renormalize_percent(&[2_500, 2_500, 2_500]), vec![3_400, 3_300, 3_300]);
        assert_eq!(renormalize_percent(&[3_000, 2_000]), vec![6_000, 4_000]);
        let r = renormalize_percent(&[200, 300, 4_000, 700]);
        assert_eq!(r.iter().map(|&w| w as u64).sum::<u64>(), 10_000);
    }

    const USD: u128 = 1_000_000;

    /// The spec's worked example, row by row.
    #[test]
    fn worked_example() {
        let mut supply: u64 = 1_000 * ONE_TOKEN;
        let mut hwm: u64 = 100 * USD as u64;

        // Launch with a $100,000 vault: unit price $100, nothing due.
        assert_eq!(unit_price_e6(100_000 * USD, supply), 100 * USD as u64);
        assert_eq!(commission(100_000 * USD, supply, hwm, 2_000), None);

        // Stocks rise 25%: $125,000 vault, commission $5,000.
        let v = 125_000 * USD;
        let c = commission(v, supply, hwm, 2_000).unwrap();
        assert_eq!(c.commission_e6, 5_000 * USD as u64);
        let (creator, platform) = split_fee(c.fee_tokens, 2_000);
        // Creator gets $4,000 and platform $1,000 worth at the new unit price.
        supply += c.fee_tokens;
        hwm = c.hwm_after_e6;
        assert_eq!(hwm, 120 * USD as u64);
        assert_eq!(supply, 1_041_666_666); // 1,041.67
        let unit = unit_price_e6(v, supply) as u128;
        assert_eq!(value_e6(creator, unit as u64, 6) / USD, 3_999); // $4,000 less rounding dust
        assert_eq!((value_e6(platform, unit as u64, 6) + USD / 2) / USD, 1_000);

        // Stocks fall 10%: unit price $108, below the mark, nothing due.
        let v = v * 9 / 10;
        assert_eq!(unit_price_e6(v, supply), 108 * USD as u64);
        assert_eq!(commission(v, supply, hwm, 2_000), None);

        // Stocks recover to a $130 unit price: commission $2,083.
        let v = 130 * USD * supply as u128 / ONE_TOKEN as u128;
        let c = commission(v, supply, hwm, 2_000).unwrap();
        assert_eq!(c.commission_e6 / USD as u64, 2_083);
        supply += c.fee_tokens;
        assert_eq!(c.hwm_after_e6 / 10_000, 12_800); // $128.00
        assert_eq!((supply + 5_000) / 10_000, 105_794); // 1,057.94

        // A holder from launch is up 28%.
        assert_eq!(unit_price_e6(v, supply) / 10_000, 12_800);
    }

    #[test]
    fn no_commission_at_or_below_mark() {
        assert_eq!(commission(100 * USD, ONE_TOKEN, 100 * USD as u64, 2_000), None);
        assert_eq!(commission(99 * USD, ONE_TOKEN, 100 * USD as u64, 2_000), None);
        assert_eq!(commission(0, 0, 100 * USD as u64, 2_000), None);
    }

    #[test]
    fn commission_preserves_value_identity() {
        // After fee tokens, supply × unit price still equals the vault value (to rounding).
        let v = 777_777 * USD;
        let s = 5_555 * ONE_TOKEN;
        let c = commission(v, s, 100 * USD as u64, 2_000).unwrap();
        let s2 = s + c.fee_tokens;
        let u2 = unit_price_e6(v, s2) as u128;
        let implied = u2 * s2 as u128 / ONE_TOKEN as u128;
        assert!(v - implied < s2 as u128 / ONE_TOKEN as u128 + 1);
        assert_eq!(u2 as u64, c.hwm_after_e6);
    }

    #[test]
    fn split_is_exact() {
        let parts = split_proportional(1_000_003, &[25, 25, 25, 25]);
        assert_eq!(parts.iter().sum::<u64>(), 1_000_003);
        let parts = split_proportional(7, &[0, 0]);
        assert_eq!(parts, vec![0, 0]);
    }

    #[test]
    fn mint_tokens_capped_by_spend() {
        // $250 spent on 2.5 shares (8 dp) at a $100 reference: 2.5 bucket tokens at $100.
        assert_eq!(mint_tokens(250_000_000, 100 * USD as u64, 8, 250 * USD as u64, 100 * USD as u64), 2_500_000);
        // Reference price too high (stale): value capped at what was spent.
        assert_eq!(mint_tokens(250_000_000, 200 * USD as u64, 8, 250 * USD as u64, 100 * USD as u64), 2_500_000);
        // Swap cost: $250 bought $249 worth, 2.49 tokens.
        assert_eq!(mint_tokens(249_000_000, 100 * USD as u64, 8, 250 * USD as u64, 100 * USD as u64), 2_490_000);
    }

    #[test]
    fn slippage_bound() {
        assert!(within_slippage(990, 1_000, 100));
        assert!(!within_slippage(989, 1_000, 100));
        assert!(within_slippage(1_200, 1_000, 0));
    }

    #[test]
    fn redeem_is_pro_rata_and_rounds_down() {
        assert_eq!(redeem_qty(1_000, 250, 1_000), 250);
        assert_eq!(redeem_qty(999, 1, 1_000), 0);
        assert_eq!(redeem_qty(1_000, 1_000, 1_000), 1_000);
    }

    #[test]
    fn price_clamp_and_twap() {
        assert_eq!(clamp_price(130, 100, 2_000), (120, true));
        assert_eq!(clamp_price(70, 100, 2_000), (80, true));
        assert_eq!(clamp_price(110, 100, 2_000), (110, false));
        assert_eq!(clamp_price(500, 0, 2_000), (500, false));
        assert_eq!(twap_update(100, 200, 1_800, 3_600), 150);
        assert_eq!(twap_update(100, 200, 10_000, 3_600), 200);
        assert_eq!(twap_update(0, 200, 5, 3_600), 200);
    }
}
