'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSession } from '@/auth/SessionProvider';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { ErrorNote } from '@/components/ui/primitives';
import ui from '@/components/ui/ui.module.css';
import { refreshAfterTx, useApiQuery, useMe } from '@/hooks/api';
import { useIsPhone } from '@/hooks/useMediaQuery';
import { getApi } from '@/lib/api';
import type { BucketDetail, MintQuote } from '@/lib/api/types';
import { NotSharesText } from '@/components/bucket/NotShares';
import {
  COMMISSION_PCT,
  COMMISSION_SPLIT_TEXT,
  CREATOR_SHARE_PCT,
  MINT_FEE_PCT,
  MIN_DEPOSIT_USD,
  PLATFORM_SHARE_PCT,
  SLIPPAGE_PCT,
  commissionExample,
} from '@/lib/constants';
import { cleanUsdInput, decimalString, maybeNum, num, pct, tokens as fmtTokens, usd, usdOr } from '@/lib/format';
import { useGeoBlocked } from '@/hooks/useGeoBlocked';
import { GEO_MESSAGE } from '@/lib/geo';
import { friendlyError, signAndSubmit, type FriendlyError } from '@/lib/txFlow';
import { LegList, isFinished, useOrder } from './OrderProgress';
import m from './modals.module.css';

type Stage = 'form' | 'working' | 'filling' | 'done';
const PRESETS = [50, 250, 1000, 2500];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function InvestModal({
  open,
  onClose,
  bucket,
  onMakePnl,
}: {
  open: boolean;
  onClose: () => void;
  bucket: BucketDetail;
  onMakePnl: () => void;
}) {
  const router = useRouter();
  const auth = useAuth();
  const { requireSignIn } = useSession();
  const isPhone = useIsPhone();
  const geoBlocked = useGeoBlocked();
  const me = useMe();
  const [amount, setAmount] = useState('250');
  const [stage, setStage] = useState<Stage>('form');
  const [working, setWorking] = useState('');
  const [error, setError] = useState<FriendlyError | null>(null);
  const [orderAddr, setOrderAddr] = useState<string | null>(null);
  const [poolResult, setPoolResult] = useState<{ tokens: string; usdc: string } | null>(null);
  const { order, slow } = useOrder(stage === 'filling' || stage === 'done' ? orderAddr : null);

  const amt = num(amount);
  const debounced = useDebounced(amount, 300);
  const quote = useApiQuery<MintQuote>(
    open && num(debounced) > 0 ? ['quoteMint', bucket.address, debounced] : null,
    (api) => api.quoteMint(bucket.address, decimalString(num(debounced), 2)),
    { keepPreviousData: true },
  );
  const q = quote.data;
  const chosen = q?.routes.find((r) => r.kind === q.chosen) ?? null;
  const mintRoute = q?.routes.find((r) => r.kind === 'mint');
  const poolRoute = q?.routes.find((r) => r.kind === 'pool');
  const balance = maybeNum(me.data?.usdcBalance);
  const reasonText = (r: string | null | undefined): string | null =>
    r === 'bucket_closed'
      ? 'Closed to new money'
      : r === 'below_minimum'
        ? `Below the ${usd(MIN_DEPOSIT_USD, 0)} minimum`
        : r === 'leg_below_min_trade'
          ? 'Amount too small for every stock leg to trade'
          : r === 'no_pool'
            ? 'No pool for this bucket yet'
            : r === 'pool_quotes_not_supported'
              ? 'Pool quotes are not available yet'
              : r
                ? r.replace(/_/g, ' ')
                : null;
  const unit = num(bucket.unitPrice);
  const tickersPre = bucket.holdings.filter((h) => h.assetType === 'pre_ipo').map((h) => h.ticker);
  const example = commissionExample(amt);
  const feeUsd = q ? num(q.feeUsd) : 0;
  const closed = bucket.status === 'closed';

  // Order finished → Done.
  useEffect(() => {
    if (stage === 'filling' && isFinished(order)) {
      setStage('done');
      void refreshAfterTx();
    }
  }, [stage, order]);

  // Reset when reopened.
  useEffect(() => {
    if (open) {
      setStage('form');
      setError(null);
      setOrderAddr(null);
      setPoolResult(null);
    }
  }, [open]);

  let validation: string | null = null;
  if (geoBlocked) validation = `${GEO_MESSAGE} Selling or redeeming tokens you already hold still works.`;
  else if (closed) validation = 'This bucket is closed to new money. Redeem stays open.';
  else if (bucket.fundingState === 'awaiting_creator') validation = "Opens once the creator's stake has filled.";
  else if (amt > 0 && amt < MIN_DEPOSIT_USD) validation = `The minimum is ${usd(MIN_DEPOSIT_USD)}.`;
  else if (q && !q.chosen && num(debounced) === amt)
    validation = `No route can fill this amount right now${reasonText(mintRoute?.reason) ? ` (${reasonText(mintRoute?.reason)})` : ''}.`;
  const short = balance !== null && amt > balance + 1e-9;

  const confirm = async () => {
    setError(null);
    const wallet = await requireSignIn();
    if (!wallet) return;
    setStage('working');
    setWorking('Preparing your transaction…');
    try {
      const api = await getApi();
      const caller = { wallet, token: auth.getAccessToken };
      const res = await api.txMint(caller, { bucket: bucket.address, amountUsd: decimalString(amt, 2) });
      await signAndSubmit([res.transaction], caller, auth.signTransaction, (st) =>
        setWorking(st === 'signing' ? 'Waiting for your signature…' : 'Submitting…'),
      );
      if (res.order) {
        setOrderAddr(res.order);
        setStage('filling');
      } else {
        setPoolResult({ tokens: chosen?.tokensOut ?? '0', usdc: decimalString(amt, 2) });
        setStage('done');
        void refreshAfterTx();
      }
    } catch (e) {
      setError(friendlyError(e));
      setStage('form');
    }
  };

  const titleId = 'invest-title';
  const doneTokens = order?.tokens ?? poolResult?.tokens ?? chosen?.tokensOut ?? '0';
  const doneUsdc = order?.usdc ?? poolResult?.usdc ?? decimalString(amt, 2);
  const effective = num(doneTokens) > 0 ? num(doneUsdc) / num(doneTokens) : num(chosen?.effectivePrice);
  const refunded = order?.status === 'refunded';

  const feeParagraph =
    (q?.chosen === 'pool' || feeUsd === 0
      ? 'No entry fee, no management fee. '
      : `No management fee. The only entry cost is the ${MINT_FEE_PCT.toFixed(2)}% mint fee above. `) +
    `Commission is ${COMMISSION_PCT}% of the rise in unit price above ${usd(bucket.hwm)}, ${COMMISSION_SPLIT_TEXT}. Below that high, nothing is charged. On ${usd(amt, 0)}, a 20% rise costs about ${usd(example, 0)} of your gain in commission.`;

  // The 0.20% mint fee always gets its own row; the pool route has none.
  const mintFeeRow = (
    <div className={ui.row}>
      <span>Mint fee</span>
      <span>
        {q?.chosen === 'pool'
          ? 'none on the pool route'
          : `${MINT_FEE_PCT.toFixed(2)}% · ${usd(q ? q.feeUsd : (amt * MINT_FEE_PCT) / 100)}`}
      </span>
    </div>
  );
  // Only when the backend supplies it (a first-time holder's token account).
  const rentRow =
    q && q.rentUsd !== null && num(q.rentUsd) > 0 ? (
      <div className={ui.row}>
        <span>One-time account rent</span>
        <span>{usd(q.rentUsd)}</span>
      </div>
    ) : null;

  // A 451 already shows as the validation line; do not repeat it.
  const errorBlock = error && !geoBlocked ? (
    <div style={{ marginTop: 14 }}>
      <ErrorNote
        action={
          error.addFunds ? (
            <Link href="/account#add-funds" className={ui.btnAccent} onClick={onClose}>
              Add funds
            </Link>
          ) : null
        }
      >
        {error.message}
      </ErrorNote>
    </div>
  ) : null;

  const amountField = (
    <>
      <label htmlFor="invest-amount" className={ui.label}>
        Amount in USDC
      </label>
      <div className={m.amountBox}>
        <span className={m.dollar} aria-hidden="true">
          $
        </span>
        <input
          id="invest-amount"
          className={m.amountInput}
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          onChange={(e) => setAmount(cleanUsdInput(e.target.value))}
          aria-describedby="invest-balance"
          data-autofocus
        />
      </div>
      <div className={m.presets}>
        {PRESETS.map((p) => (
          <button key={p} type="button" className={m.preset} aria-pressed={amt === p} onClick={() => setAmount(String(p))}>
            ${p.toLocaleString('en-US')}
          </button>
        ))}
        <span id="invest-balance" className={m.balance}>
          Balance {balance !== null ? usd(balance) : '—'}
        </span>
      </div>
      {validation ? (
        <div className={ui.small} role="alert" style={{ marginTop: 8 }}>
          {validation}
        </div>
      ) : null}
      {short && !validation ? (
        <div className={ui.small} role="alert" style={{ marginTop: 8 }}>
          That is more than your {usd(balance ?? 0)} USDC.{' '}
          <Link href="/account#add-funds" onClick={onClose}>
            Add funds
          </Link>
        </div>
      ) : null}
    </>
  );

  // Verbatim from docs/legal/not-shares-notice.md, before the confirm button, on every route.
  const notShares =
    tickersPre.length > 0 ? (
      <div className={ui.notice} style={{ marginTop: 10 }}>
        <NotSharesText holdings={bucket.holdings} />
      </div>
    ) : null;

  const canConfirm = !validation && !short && amt >= MIN_DEPOSIT_USD && !!chosen && !quote.isLoading && stage === 'form';
  const confirmLabel = stage === 'working' ? working : `Confirm · ${usd(amt, amt % 1 ? 2 : 0)}`;

  const form = isPhone ? (
    // Phone: the design's "Confirm investment" sheet.
    <div className={m.body}>
      <div className={m.sheetAmount}>{amountField}</div>
      <div className={ui.rows} style={{ marginTop: 16, borderTop: '1px solid var(--c-line)', paddingTop: 14 }}>
        <div className={ui.row}>
          <span>Bucket</span>
          <span>{bucket.name}</span>
        </div>
        <div className={ui.row}>
          <span>Route</span>
          <span>{q ? (q.chosen === 'mint' ? 'Mint at unit price' : 'Meteora pool') : '—'}</span>
        </div>
        <div className={ui.row}>
          <span>Tokens received</span>
          <span>{chosen ? fmtTokens(chosen.tokensOut) : '—'}</span>
        </div>
        <div className={ui.row}>
          <span>Effective price</span>
          <span>{usdOr(chosen?.effectivePrice)}</span>
        </div>
        {mintFeeRow}
        {rentRow}
        <div className={ui.row}>
          <span>Network fee</span>
          <span>sponsored</span>
        </div>
      </div>
      <div className={ui.noticeAccent} style={{ marginTop: 14, fontSize: 12 }}>
        If this bucket rises 20%, commission takes {usd(example, 0)} of your gain ({CREATOR_SHARE_PCT}% to the creator,{' '}
        {PLATFORM_SHARE_PCT}% to Bucket). Nothing while it is below its high.
      </div>
      {notShares}
      {errorBlock}
      <button
        type="button"
        className={`${canConfirm ? ui.btnAccent : ui.btnDisabled} ${ui.btnLarge} ${m.confirm}`}
        disabled={!canConfirm}
        onClick={confirm}
        aria-live="polite"
      >
        {stage === 'working' ? working : 'Confirm'}
      </button>
      <div className={m.foot}>Network fee sponsored</div>
    </div>
  ) : (
    <div className={m.body}>
      {amountField}
      <div className={m.routes}>
        <div className={`${ui.label} ${m.routesHead}`}>Route · cheaper of two, automatically</div>
        {mintRoute ? (
          <div className={q?.chosen === 'mint' ? m.routeChosen : m.route}>
            <div>
              <div className={m.routeName}>Mint at unit price</div>
              <div className={m.routeDetail}>
                {mintRoute.available
                  ? `Buys every holding into the vault${mintRoute.costUsd !== null ? ` · ${pct((num(mintRoute.costUsd) / Math.max(amt, 1e-9)) * 100, 2).replace('+', '')} swap cost` : ''}`
                  : (reasonText(mintRoute.reason) ?? (closed ? 'Closed to new money' : 'Not available for this amount'))}
              </div>
            </div>
            <div className={m.routeRight}>
              <div className={m.routeTokens}>{mintRoute.available ? `${fmtTokens(mintRoute.tokensOut)} tokens` : '—'}</div>
              <div className={m.routeCost}>{mintRoute.effectivePrice ? `${usd(mintRoute.effectivePrice)} each` : ''}</div>
            </div>
          </div>
        ) : null}
        {poolRoute ? (
          <div className={q?.chosen === 'pool' ? m.routeChosen : m.route}>
            <div>
              <div className={m.routeName}>Swap in Meteora pool</div>
              <div className={m.routeDetail}>
                {poolRoute.available
                  ? `Instant · pool sits ${num(bucket.premiumPct) >= 0 ? 'above' : 'below'} unit price`
                  : (reasonText(poolRoute.reason) ?? 'No pool liquidity yet')}
              </div>
            </div>
            <div className={m.routeRight}>
              <div className={m.routeTokens}>{poolRoute.available ? `${fmtTokens(poolRoute.tokensOut)} tokens` : '—'}</div>
              <div className={m.routeCost}>{poolRoute.effectivePrice ? `${usd(poolRoute.effectivePrice)} each` : ''}</div>
            </div>
          </div>
        ) : null}
        {!q ? <div className={m.route}>{quote.error ? 'Could not get a quote.' : 'Getting a quote…'}</div> : null}
      </div>
      <div className={`${ui.rows} ${m.summary}`} style={{ gap: 8 }}>
        <div className={ui.row}>
          <span>Route chosen</span>
          <span>{q ? (q.chosen === 'mint' ? 'Mint' : 'Pool swap') : '—'}</span>
        </div>
        <div className={ui.row}>
          <span>Tokens received</span>
          <span>{chosen ? fmtTokens(chosen.tokensOut) : '—'}</span>
        </div>
        <div className={ui.row}>
          <span>Effective price vs unit</span>
          <span>{chosen ? pct(chosen.effectiveVsUnitPct, 2) : '—'}</span>
        </div>
        {mintFeeRow}
        <div className={ui.row}>
          <span>Slippage bound per leg</span>
          <span>{SLIPPAGE_PCT.toFixed(2)}%</span>
        </div>
        {rentRow}
        <div className={ui.row}>
          <span>Network fee</span>
          <span>sponsored</span>
        </div>
      </div>
      <div className={m.howBox}>
        <div className={ui.labelInk}>How the 20% works</div>
        <div className={m.howText}>{feeParagraph}</div>
      </div>
      {notShares}
      {errorBlock}
      <button
        type="button"
        className={`${canConfirm ? ui.btnInk : ui.btnDisabled} ${ui.btnLarge} ${m.confirm}`}
        disabled={!canConfirm}
        onClick={confirm}
        aria-live="polite"
      >
        {confirmLabel}
      </button>
      <div className={m.foot}>One confirmation. Network fee sponsored. Unfilled USDC comes back to you.</div>
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId} width={520} locked={stage === 'working'}>
      <ModalHeader
        kicker={isPhone && stage === 'form' ? `INVEST · ${bucket.name.toUpperCase()}` : 'INVEST'}
        title={isPhone && stage === 'form' ? 'Confirm investment' : bucket.name}
        titleId={titleId}
        onClose={onClose}
        closeDisabled={stage === 'working'}
      />
      {stage === 'form' || stage === 'working' ? form : null}
      {stage === 'filling' ? (
        <div style={{ padding: '26px 20px' }}>
          <h3 className={m.fillTitle}>Filling</h3>
          <p className={ui.small} style={{ fontSize: 13, margin: '4px 0 0' }}>
            Buying every holding into the vault in its current proportions. Tokens arrive as each leg completes.
          </p>
          <LegList order={order} fallbackLegs={bucket.holdings} />
          {slow ? (
            <p className={ui.small} style={{ marginTop: 12 }}>
              This is taking longer than usual. You can close this window: the order keeps filling, and if it expires any
              unfilled USDC is refunded to your wallet automatically.
            </p>
          ) : null}
        </div>
      ) : null}
      {stage === 'done' ? (
        <div style={{ padding: '26px 20px' }}>
          <div className={m.check} aria-hidden="true">
            ✓
          </div>
          <h3 className={m.doneTitle}>
            {refunded ? 'Partly filled. ' : ''}You own {fmtTokens(doneTokens)} tokens of {bucket.name}
          </h3>
          <p className={m.doneText}>
            {refunded
              ? `A leg moved more than the ${SLIPPAGE_PCT}% slippage bound, so it did not fill. ${usd(Math.max(0, amt - num(doneUsdc)))} of unfilled USDC came back to your wallet. `
              : ''}
            Filled at {usd(effective)} against a unit price of {usd(unit)}. The tokens are in your wallet and can be redeemed
            for the vault&apos;s stocks at any time, with no lock-up.
          </p>
          <div className={m.btnRow}>
            <button
              type="button"
              className={`${ui.btn} ${ui.btnMedium}`}
              onClick={() => {
                onClose();
                router.push('/portfolio');
              }}
            >
              See portfolio
            </button>
            <button type="button" className={`${ui.btnAccent} ${ui.btnMedium}`} style={{ fontWeight: 700 }} onClick={onMakePnl}>
              Make a PnL card
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
