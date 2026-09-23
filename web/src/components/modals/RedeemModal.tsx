'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSession } from '@/auth/SessionProvider';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { ErrorNote } from '@/components/ui/primitives';
import ui from '@/components/ui/ui.module.css';
import { refreshAfterTx, useApiQuery } from '@/hooks/api';
import { getApi } from '@/lib/api';
import type { BucketDetail, RedeemQuote } from '@/lib/api/types';
import { decimalString, num, pct, tokens as fmtTokens, usd } from '@/lib/format';
import { friendlyError, signAndSubmit, type FriendlyError } from '@/lib/txFlow';
import { LegList, isFinished, useOrder } from './OrderProgress';
import m from './modals.module.css';

type Stage = 'form' | 'working' | 'filling' | 'done';

export function RedeemModal({
  open,
  onClose,
  bucket,
  positionTokens,
}: {
  open: boolean;
  onClose: () => void;
  bucket: BucketDetail;
  /** Bucket tokens held, as a decimal string, or null when the wallet holds none. */
  positionTokens: string | null;
}) {
  const auth = useAuth();
  const { requireSignIn } = useSession();
  const [pctExit, setPctExit] = useState(50);
  const [debouncedPct, setDebouncedPct] = useState(50);
  const [stage, setStage] = useState<Stage>('form');
  const [working, setWorking] = useState('');
  const [error, setError] = useState<FriendlyError | null>(null);
  const [orderAddr, setOrderAddr] = useState<string | null>(null);
  const [instantUsdc, setInstantUsdc] = useState<string | null>(null);
  const { order, slow } = useOrder(stage === 'filling' || stage === 'done' ? orderAddr : null);

  const held = num(positionTokens);
  const burn = (held * pctExit) / 100;
  const burnDebounced = (held * debouncedPct) / 100;

  useEffect(() => {
    const id = setTimeout(() => setDebouncedPct(pctExit), 250);
    return () => clearTimeout(id);
  }, [pctExit]);

  useEffect(() => {
    if (open) {
      setStage('form');
      setError(null);
      setOrderAddr(null);
      setInstantUsdc(null);
    }
  }, [open]);

  useEffect(() => {
    if (stage === 'filling' && isFinished(order)) {
      setStage('done');
      void refreshAfterTx();
    }
  }, [stage, order]);

  const quote = useApiQuery<RedeemQuote>(
    open && burnDebounced > 0 ? ['quoteRedeem', bucket.address, decimalString(burnDebounced)] : null,
    (api) => api.quoteRedeem(bucket.address, decimalString(burnDebounced)),
    { keepPreviousData: true },
  );
  const q = quote.data;
  const chosen = q?.routes.find((r) => r.kind === q.chosen) ?? null;
  const unit = num(bucket.unitPrice);
  const receiveEstimate = chosen ? num(chosen.usdcOut) * (burn / Math.max(burnDebounced, 1e-12)) : burn * unit;

  const confirm = async () => {
    setError(null);
    const wallet = await requireSignIn();
    if (!wallet) return;
    setStage('working');
    setWorking('Preparing your transaction…');
    try {
      const api = await getApi();
      const caller = { wallet, token: auth.getAccessToken };
      const res = await api.txRedeem(caller, { bucket: bucket.address, tokens: decimalString(burn) });
      await signAndSubmit([res.transaction], caller, auth.signTransaction, (st) =>
        setWorking(st === 'signing' ? 'Waiting for your signature…' : 'Submitting…'),
      );
      if (res.order) {
        setOrderAddr(res.order);
        setStage('filling');
      } else {
        setInstantUsdc(decimalString(receiveEstimate, 2));
        setStage('done');
        void refreshAfterTx();
      }
    } catch (e) {
      setError(friendlyError(e));
      setStage('form');
    }
  };

  const titleId = 'redeem-title';
  const received = order?.usdc ?? instantUsdc ?? '0';

  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId} width={520} locked={stage === 'working'}>
      <ModalHeader kicker="SELL OR REDEEM" title={bucket.name} titleId={titleId} onClose={onClose} closeDisabled={stage === 'working'} />
      {held <= 0 && stage === 'form' ? (
        <div className={m.body}>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
            This wallet holds no {bucket.name} tokens, so there is nothing to exit. Tokens held in another wallet can be
            redeemed from that wallet, with or without this app.
          </p>
          <button type="button" className={`${ui.btn} ${ui.btnMedium}`} style={{ marginTop: 16 }} onClick={onClose}>
            Close
          </button>
        </div>
      ) : null}
      {held > 0 && (stage === 'form' || stage === 'working') ? (
        <div className={m.body}>
          <div className={m.pctRow}>
            <label htmlFor="redeem-pct" className={ui.label}>
              How much to exit
            </label>
            <span className={m.pctValue} aria-hidden="true">
              {pctExit}%
            </span>
          </div>
          <input
            id="redeem-pct"
            type="range"
            min={1}
            max={100}
            value={pctExit}
            onChange={(e) => setPctExit(parseInt(e.target.value, 10))}
            className={m.range}
            aria-valuetext={`${pctExit}% of your ${fmtTokens(held)} tokens`}
            data-autofocus
          />
          <div className={`${ui.rows} ${m.divided}`}>
            <div className={ui.row}>
              <span>Tokens burned</span>
              <span>{fmtTokens(burn)}</span>
            </div>
            <div className={ui.row}>
              <span>Route</span>
              <span>{q ? (q.chosen === 'mint' ? 'Redeem from vault' : 'Sell in Meteora pool') : '—'}</span>
            </div>
            <div className={ui.row}>
              <span>Effective price vs unit</span>
              <span>{chosen ? pct(chosen.effectiveVsUnitPct, 2).replace('-', '−') : '—'}</span>
            </div>
            <div className={ui.row}>
              <span>Exit fee</span>
              <span>{q && num(q.feeUsd) > 0 ? usd(q.feeUsd) : 'none'}</span>
            </div>
            <div className={ui.row}>
              <span>You receive</span>
              <span style={{ fontWeight: 600 }}>{usd(receiveEstimate)}</span>
            </div>
          </div>
          <div className={ui.notice} style={{ marginTop: 16 }}>
            Redeem burns your tokens and sells your pro-rata slice of every stock. No lock-up, no exit fee. It works even if
            the creator is inactive, the pool is empty or this app is offline.
          </div>
          {error ? (
            <div style={{ marginTop: 14 }}>
              <ErrorNote>{error.message}</ErrorNote>
            </div>
          ) : null}
          <button
            type="button"
            className={`${stage === 'form' && chosen ? ui.btnInk : ui.btnDisabled} ${ui.btnLarge} ${m.confirm}`}
            disabled={stage !== 'form' || !chosen}
            onClick={confirm}
            aria-live="polite"
          >
            {stage === 'working' ? working : `Confirm exit · ${usd(receiveEstimate)}`}
          </button>
        </div>
      ) : null}
      {stage === 'filling' ? (
        <div style={{ padding: '26px 20px' }}>
          <h3 className={m.fillTitle}>Selling your slice</h3>
          <p className={ui.small} style={{ fontSize: 13, margin: '4px 0 0' }}>
            Your tokens are burned. Each holding&apos;s share is sold to USDC and paid to your wallet as its leg completes.
          </p>
          <LegList order={order} fallbackLegs={bucket.holdings} />
          {slow ? (
            <p className={ui.small} style={{ marginTop: 12 }}>
              Taking longer than usual. Anything that cannot be sold can be claimed in kind straight to your wallet.
            </p>
          ) : null}
        </div>
      ) : null}
      {stage === 'done' ? (
        <div style={{ padding: '26px 20px' }}>
          <div className={m.check} aria-hidden="true">
            ✓
          </div>
          <h3 className={m.doneTitle}>You received {usd(received)}</h3>
          <p className={m.doneText}>The USDC is in your wallet. No exit fee was charged.</p>
          <button type="button" className={`${ui.btn} ${ui.btnMedium}`} style={{ marginTop: 20 }} onClick={onClose}>
            Done
          </button>
        </div>
      ) : null}
    </Modal>
  );
}
