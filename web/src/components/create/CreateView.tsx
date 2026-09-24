'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useSession } from '@/auth/SessionProvider';
import { ConfirmSheet } from '@/components/modals/ConfirmSheet';
import { isFinished, useOrder } from '@/components/modals/OrderProgress';
import { Modal } from '@/components/ui/Modal';
import { ErrorNote, Label, PreIpoLabel, SourceBadge, useCopy } from '@/components/ui/primitives';
import ui from '@/components/ui/ui.module.css';
import { refreshAfterTx, useApiQuery, useMe } from '@/hooks/api';
import { getApi } from '@/lib/api';
import type { BucketDetail, CatalogToken, CreateBucketResult } from '@/lib/api/types';
import { shareLink } from '@/lib/config';
import {
  COMMISSION_PCT,
  EDIT_NOTE_MAX,
  MAX_ACTIVE_BUCKETS,
  MAX_HOLDINGS,
  MAX_WEIGHT_PRE_IPO_PCT,
  MAX_WEIGHT_PUBLIC_PCT,
  MIN_CREATOR_STAKE_USD,
  MIN_HOLDINGS,
  MIN_WEIGHT_PCT,
  NAME_MAX_BYTES,
  PLATFORM_SHARE_PCT,
  THESIS_MAX,
} from '@/lib/constants';
import { cleanUsdInput, decimalString, maybeNum, num, usd } from '@/lib/format';
import { NOT_SHARES_ONE_LINE } from '@/components/bucket/NotShares';
import { useGeoBlocked } from '@/hooks/useGeoBlocked';
import { GEO_MESSAGE } from '@/lib/geo';
import { friendlyError, signAndSubmit, type FriendlyError } from '@/lib/txFlow';
import c from './create.module.css';

/**
 * Why a catalog token cannot be added, from the API's eligibility reason. Every ineligible token
 * used to read "Below floor", including ones with millions in liquidity whose real reason was an
 * issuer deadline — or no verdict yet at all.
 */
const INELIGIBLE_LABEL: Record<string, string> = {
  below_liquidity_floor: 'Below floor',
  no_price: 'No price',
  no_route: 'No route',
  flagged: 'Flagged',
  disabled_on_chain: 'Disabled',
  issuer_redemption_window: 'Redeeming',
  issuer_conversion_deadline: 'Converting',
};
const ineligibleLabel = (reason: string | null): string => (reason ? (INELIGIBLE_LABEL[reason] ?? 'Not eligible') : 'Not eligible');

interface DraftHolding {
  mint: string;
  w: number;
}
interface Draft {
  name: string;
  thesis: string;
  stake: string;
  holdings: DraftHolding[];
}

const DRAFT_KEY = 'bucket.draft.v1';
const EMPTY: Draft = { name: '', thesis: '', stake: '25', holdings: [] };

function loadDraft(): Draft {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (raw) return { ...EMPTY, ...(JSON.parse(raw) as Partial<Draft>) };
  } catch {
    /* ignore */
  }
  return EMPTY;
}

function maxFor(t: CatalogToken | undefined): number {
  if (!t) return MAX_WEIGHT_PUBLIC_PCT;
  return t.maxWeightPct || (t.assetType === 'pre_ipo' ? MAX_WEIGHT_PRE_IPO_PCT : MAX_WEIGHT_PUBLIC_PCT);
}

const bytes = (s: string) => new TextEncoder().encode(s).length;

export function CreateView({ editSlug }: { editSlug: string | null }) {
  const router = useRouter();
  const auth = useAuth();
  const { requireSignIn } = useSession();
  const me = useMe();
  const geoBlocked = useGeoBlocked();
  const catalogQ = useApiQuery(['catalog'], (api) => api.catalog());
  const editQ = useApiQuery(editSlug ? ['bucket', editSlug] : null, (api) => api.bucket(editSlug!));
  const catalog = useMemo(() => catalogQ.data?.tokens ?? [], [catalogQ.data]);
  const byMint = useMemo(() => new Map(catalog.map((t) => [t.mint, t])), [catalog]);

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [note, setNote] = useState('');

  // Load the saved draft (create mode) or the bucket's current weights (edit mode).
  useEffect(() => {
    if (editSlug) return;
    setDraft(loadDraft());
    setLoaded(true);
  }, [editSlug]);
  useEffect(() => {
    if (!editSlug || !editQ.data) return;
    const d = editQ.data;
    setDraft({ name: d.name, thesis: d.thesis, stake: '0', holdings: d.holdings.map((h) => ({ mint: h.mint, w: h.weightPct })) });
    setLoaded(true);
  }, [editSlug, editQ.data]);
  useEffect(() => {
    if (!loaded || editSlug) return;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* ignore */
    }
  }, [draft, loaded, editSlug]);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const sum = draft.holdings.reduce((a, h) => a + h.w, 0);
  const stake = num(draft.stake);
  const balance = maybeNum(me.data?.usdcBalance);

  const toggle = (t: CatalogToken) =>
    setDraft((d) => {
      if (d.holdings.some((h) => h.mint === t.mint)) return { ...d, holdings: d.holdings.filter((h) => h.mint !== t.mint) };
      if (d.holdings.length >= MAX_HOLDINGS) return d;
      const used = d.holdings.reduce((a, h) => a + h.w, 0);
      const w = Math.max(MIN_WEIGHT_PCT, Math.min(maxFor(t), 100 - used || 10));
      return { ...d, holdings: [...d.holdings, { mint: t.mint, w }] };
    });
  const setWeight = (mint: string, w: number) =>
    setDraft((d) => ({ ...d, holdings: d.holdings.map((h) => (h.mint === mint ? { ...h, w } : h)) }));
  const equalWeight = () =>
    setDraft((d) => {
      const n = d.holdings.length;
      if (!n) return d;
      const base = Math.floor(100 / n);
      return { ...d, holdings: d.holdings.map((h, i) => ({ ...h, w: base + (i < 100 - base * n ? 1 : 0) })) };
    });

  const q = query.trim().toLowerCase();
  const results = catalog.filter((t) => !q || t.ticker.toLowerCase().includes(q) || t.name.toLowerCase().includes(q));

  const outOfRange = draft.holdings.some((h) => h.w < MIN_WEIGHT_PCT || h.w > maxFor(byMint.get(h.mint)) || !Number.isInteger(h.w));
  let blocker: string | null = null;
  if (editSlug && editQ.data?.pendingEdit) blocker = 'A weights edit is already pending';
  else if (editSlug && editQ.data?.status === 'closed') blocker = 'Closed buckets cannot change weights';
  else if (draft.holdings.length < MIN_HOLDINGS) blocker = `Pick at least ${MIN_HOLDINGS} tokens`;
  else if (sum !== 100) blocker = 'Weights must sum to 100%';
  else if (outOfRange) blocker = 'A weight is outside its allowed range';
  else if (!editSlug && !draft.name.trim()) blocker = 'Name your bucket';
  else if (!editSlug && bytes(draft.name.trim()) > NAME_MAX_BYTES) blocker = 'Name is too long';
  else if (!editSlug && stake < MIN_CREATOR_STAKE_USD) blocker = `Stake at least ${usd(MIN_CREATOR_STAKE_USD, 0)}`;
  else if (!editSlug && balance !== null && stake > balance) blocker = 'Not enough USDC for your stake';
  if (geoBlocked && !editSlug) blocker = GEO_MESSAGE;

  const sumHint =
    sum === 100 ? 'Ready. Weights sum to 100%.' : sum > 100 ? `${sum - 100}% over. Pull a weight down.` : `${100 - sum}% left to allocate.`;

  // ---- publish / propose edit -----------------------------------------------------------------
  const [preparing, setPreparing] = useState(false);
  const [built, setBuilt] = useState<CreateBucketResult | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [published, setPublished] = useState<{ name: string; stake: number; slug: string; order: string | null; metadataPending?: boolean } | null>(null);
  const [proposed, setProposed] = useState<{ slug: string } | null>(null);
  const editBucket: BucketDetail | undefined = editQ.data;
  const notCreator = !!editBucket && !!auth.wallet && editBucket.creator.wallet !== auth.wallet;

  /**
   * Builds the transactions to sign. Every built transaction carries a blockhash that the cluster
   * forgets after ~60s, so this runs twice: once for the confirmation sheet, and again the moment the
   * creator confirms. Otherwise the time they spend reading the sheet is charged against the batch and
   * its last transactions — the lookup table and the first mint — expire before they are submitted.
   */
  const buildTxs = async (wallet: string): Promise<CreateBucketResult> => {
    const api = await getApi();
    const caller = { wallet, token: auth.getAccessToken };
    const holdings = draft.holdings.map((h) => ({ mint: h.mint, weightPct: h.w }));
    if (editSlug && editBucket) {
      const res = await api.txProposeEdit(caller, { bucket: editBucket.address, holdings, note: note.trim() });
      return { transactions: [res.transaction], bucket: editBucket.address, slug: editBucket.slug };
    }
    return api.txCreateBucket(caller, {
      name: draft.name.trim(),
      thesis: draft.thesis.trim(),
      holdings,
      stakeUsd: decimalString(stake, 2),
    });
  };

  const prepare = async () => {
    if (blocker) return;
    setError(null);
    const wallet = await requireSignIn();
    if (!wallet) return;
    setPreparing(true);
    try {
      setBuilt(await buildTxs(wallet));
      setSheetOpen(true);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPreparing(false);
    }
  };

  const confirm = async () => {
    if (!built || !auth.wallet) return;
    setError(null);
    try {
      // Rebuilt on confirm so the blockhash is seconds old rather than as old as the sheet has been open.
      setWorking('Preparing…');
      const fresh = await buildTxs(auth.wallet);
      setBuilt(fresh);
      // The token metadata transaction is optional: if it does not land, the keeper adds the
      // metadata later and the creator only needs to know it is on its way.
      let metadataPending = false;
      await signAndSubmit(
        fresh.transactions,
        { wallet: auth.wallet, token: auth.getAccessToken },
        auth.signTransaction,
        (st, i, n) =>
          setWorking(
            st === 'signing'
              ? n > 1
                ? `Waiting for signature ${i + 1} of ${n}…`
                : 'Waiting for your signature…'
              : n > 1
                ? `Submitting ${i + 1} of ${n}…`
                : 'Submitting…',
          ),
        { optional: fresh.optional ?? [], onSkip: () => (metadataPending = true) },
      );
      setSheetOpen(false);
      void refreshAfterTx();
      if (editSlug) {
        setProposed({ slug: fresh.slug });
      } else {
        setPublished({ name: draft.name.trim(), stake, slug: fresh.slug, order: fresh.order ?? null, metadataPending });
        setDraft(EMPTY);
        try {
          window.localStorage.removeItem(DRAFT_KEY);
        } catch {
          /* ignore */
        }
      }
      setBuilt(null);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setWorking(null);
    }
  };

  if (editSlug && editQ.error) {
    return <ErrorNote>Could not load that bucket to edit. {(editQ.error as Error).message}</ErrorNote>;
  }

  const preShare = draft.holdings
    .filter((h) => byMint.get(h.mint)?.assetType === 'pre_ipo')
    .reduce((a, h) => a + h.w, 0);

  return (
    <div className={c.wrap}>
      <div className={c.left}>
        <section className={ui.card} aria-label="Name and thesis">
          <div className={c.fields}>
            {editSlug ? (
              <div>
                <Label>Editing</Label>
                <div className={c.readonly}>{editBucket?.name ?? '…'}</div>
                <p className={ui.small} style={{ margin: '6px 0 0' }}>
                  A weights edit takes effect 24 hours after you propose it, every backer is notified, and you can make at most
                  one every 7 days. Name and thesis can change any time; performance history never can.
                </p>
                {notCreator ? (
                  <div style={{ marginTop: 10 }}>
                    <ErrorNote>This wallet did not create this bucket, so it cannot propose an edit.</ErrorNote>
                  </div>
                ) : null}
                {editBucket && !notCreator ? <InfoEditor bucket={editBucket} /> : null}
              </div>
            ) : (
              <>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <label htmlFor="bucket-name" className={ui.label}>
                      Bucket name
                    </label>
                    <span className={c.counter}>
                      {bytes(draft.name)} / {NAME_MAX_BYTES}
                    </span>
                  </div>
                  <input
                    id="bucket-name"
                    className={c.nameInput}
                    value={draft.name}
                    onChange={(e) => set({ name: e.target.value })}
                    placeholder="Picks & Shovels"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <label htmlFor="bucket-thesis" className={ui.label}>
                      Thesis
                    </label>
                    <span className={c.counter} aria-live="polite">
                      {draft.thesis.length} / {THESIS_MAX}
                    </span>
                  </div>
                  <textarea
                    id="bucket-thesis"
                    className={c.thesisInput}
                    rows={2}
                    maxLength={THESIS_MAX}
                    value={draft.thesis}
                    onChange={(e) => set({ thesis: e.target.value.slice(0, THESIS_MAX) })}
                    placeholder="What is the idea, in one or two sentences?"
                  />
                </div>
              </>
            )}
          </div>
        </section>

        <section className={ui.card} aria-labelledby="catalog-title">
          <div className={ui.cardHead} style={{ gap: 12 }}>
            <h2 id="catalog-title" className={ui.cardTitle}>
              Catalog
            </h2>
            <label htmlFor="catalog-search" className="visually-hidden">
              Search ticker or company
            </label>
            <input
              id="catalog-search"
              type="search"
              className={c.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search ticker or company"
              autoComplete="off"
            />
          </div>
          <ul className={c.catalog} aria-busy={catalogQ.isLoading}>
            {catalogQ.isLoading ? <li className={ui.empty}>Loading catalog…</li> : null}
            {catalogQ.error ? (
              <li style={{ padding: 18 }}>
                <ErrorNote>Could not load the catalog.</ErrorNote>
              </li>
            ) : null}
            {results.map((t) => {
              const added = draft.holdings.some((h) => h.mint === t.mint);
              const full = !added && draft.holdings.length >= MAX_HOLDINGS;
              const blocked = !added && (!t.eligible || t.flagged);
              const action = added ? 'Added' : t.flagged ? 'Flagged' : !t.eligible ? ineligibleLabel(t.eligibilityReason) : full ? 'Max 15' : 'Add';
              return (
                <li key={t.mint}>
                  <button
                    type="button"
                    className={c.catRow}
                    aria-pressed={added}
                    disabled={full || blocked}
                    onClick={() => toggle(t)}
                    aria-label={`${added ? 'Remove' : 'Add'} ${t.ticker}, ${t.name}, ${t.source}${t.assetType === 'pre_ipo' ? ', pre-IPO' : ''}, ${usd(t.price)}`}
                  >
                    <span className={c.catTicker}>{t.ticker}</span>
                    <span className={c.catName}>
                      {t.name}
                      {t.markPrice ? ` · mark ${usd(t.markPrice)}` : ''}
                    </span>
                    <span>
                      <SourceBadge source={t.source} />
                    </span>
                    <span className={c.catPrice}>{usd(t.price)}</span>
                    <span className={c.catAction} style={{ color: added ? 'var(--c-grey-400)' : 'var(--c-ink)' }}>
                      {action}
                    </span>
                  </button>
                </li>
              );
            })}
            {!catalogQ.isLoading && results.length === 0 ? <li className={ui.empty}>No token matches “{query}”.</li> : null}
          </ul>
        </section>
      </div>

      <div className={c.right}>
        <section className={ui.cardInk} aria-labelledby="weights-title">
          <div className={c.weightsHead}>
            <h2 id="weights-title" className={ui.cardTitle}>
              Weights
            </h2>
            <button type="button" className={ui.btn} onClick={equalWeight} disabled={draft.holdings.length === 0}>
              Equal weight
            </button>
          </div>
          <ul className={c.weights}>
            {draft.holdings.map((h) => {
              const t = byMint.get(h.mint);
              const max = maxFor(t);
              const ticker = t?.ticker ?? h.mint.slice(0, 6);
              const pre = t?.assetType === 'pre_ipo';
              return (
                <li key={h.mint} className={c.weight}>
                  <div className={c.weightTop}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500 }}>{ticker}</span>
                    {pre ? <PreIpoLabel /> : null}
                    <span style={{ flex: 1 }} />
                    <input
                      type="number"
                      className={c.weightNum}
                      min={MIN_WEIGHT_PCT}
                      max={max}
                      step={1}
                      value={h.w}
                      aria-label={`${ticker} weight in percent`}
                      onChange={(e) => setWeight(h.mint, Math.round(num(e.target.value)))}
                    />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14 }} aria-hidden="true">
                      %
                    </span>
                    <button type="button" className={c.remove} onClick={() => toggle(t ?? ({ mint: h.mint } as CatalogToken))} aria-label={`Remove ${ticker}`}>
                      ×
                    </button>
                  </div>
                  <input
                    type="range"
                    className={c.slider}
                    min={MIN_WEIGHT_PCT}
                    max={max}
                    value={Math.min(max, Math.max(MIN_WEIGHT_PCT, h.w))}
                    onChange={(e) => setWeight(h.mint, parseInt(e.target.value, 10))}
                    aria-label={`${ticker} weight slider`}
                    aria-valuetext={`${h.w}%`}
                  />
                  {h.w >= max ? <div className={c.capNote}>At the {max}% cap for this asset type</div> : null}
                  {h.w < MIN_WEIGHT_PCT ? <div className={c.capNote}>Minimum {MIN_WEIGHT_PCT}%</div> : null}
                </li>
              );
            })}
            {draft.holdings.length === 0 ? (
              <li style={{ padding: '22px 0', fontSize: 13, color: 'var(--c-grey-400)', textAlign: 'center' }}>
                Pick {MIN_HOLDINGS} to {MAX_HOLDINGS} tokens from the catalog.
              </li>
            ) : null}
          </ul>
          <div className={c.total}>
            <div className={c.totalTop}>
              <span style={{ fontSize: 13, color: 'var(--c-grey-700)' }}>Total weight</span>
              <span className={c.totalNum}>{sum}%</span>
            </div>
            <div className={c.totalBar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, sum)} aria-label="Total weight">
              <div style={{ height: 8, background: sum === 100 ? 'var(--c-ink)' : 'var(--c-accent)', width: `${Math.min(100, sum)}%` }} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--c-grey-500)', marginTop: 6 }} aria-live="polite">
              {sumHint}
              {preShare > 0 ? ` Pre-IPO share ${preShare}%. ${NOT_SHARES_ONE_LINE}` : ''}
            </div>
          </div>
        </section>

        {editSlug ? (
          <section className={ui.card} style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <label htmlFor="edit-note" className={ui.label}>
                Note to backers (optional)
              </label>
              <span className={c.counter}>
                {note.length} / {EDIT_NOTE_MAX}
              </span>
            </div>
            <textarea
              id="edit-note"
              className={c.thesisInput}
              rows={2}
              maxLength={EDIT_NOTE_MAX}
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, EDIT_NOTE_MAX))}
              placeholder="Why are you changing it?"
            />
          </section>
        ) : (
          <section className={ui.card} style={{ padding: 16 }}>
            <label htmlFor="stake" className={ui.label}>
              Your stake
            </label>
            <div className={c.stakeRow}>
              <span style={{ fontSize: 20, fontWeight: 600 }} aria-hidden="true">
                $
              </span>
              <input
                id="stake"
                className={c.stakeInput}
                inputMode="decimal"
                value={draft.stake}
                onChange={(e) => set({ stake: cleanUsdInput(e.target.value) })}
                aria-describedby="stake-help"
              />
            </div>
            <div id="stake-help" style={{ fontSize: 12, color: 'var(--c-grey-500)', marginTop: 8, lineHeight: 1.5 }}>
              At least {usd(MIN_CREATOR_STAKE_USD, 0)} of your own money, held continuously, or the bucket cannot be published or
              ranked. Backers can see it.
              {balance !== null ? ` You have ${usd(balance)} USDC.` : ''}
              {balance !== null && stake > balance ? (
                <>
                  {' '}
                  <Link href="/account#add-funds">Add funds</Link>
                </>
              ) : null}
            </div>
          </section>
        )}

        <section className={ui.card} style={{ padding: 16 }} aria-labelledby="terms-title">
          <h2 id="terms-title" className={ui.label} style={{ margin: 0 }}>
            Fixed terms
          </h2>
          <dl style={{ margin: 0 }}>
            {[
              ['Commission', `${COMMISSION_PCT}% of gains above high`],
              ['Platform share of that', `${PLATFORM_SHARE_PCT}%`],
              ['Weight range', `${MIN_WEIGHT_PCT}–${MAX_WEIGHT_PUBLIC_PCT}% · ${MAX_WEIGHT_PRE_IPO_PCT}% pre-IPO`],
              ['Edits', '24h delay · 1 per 7 days'],
              ['Active buckets per wallet', String(MAX_ACTIVE_BUCKETS)],
            ].map(([k, v]) => (
              <div key={k} className={c.term}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        {error && !sheetOpen ? (
          <ErrorNote
            action={
              error.addFunds ? (
                <Link href="/account#add-funds" className={ui.btnAccent}>
                  Add funds
                </Link>
              ) : null
            }
          >
            {error.message}
          </ErrorNote>
        ) : null}
        <button
          type="button"
          className={`${blocker || notCreator ? ui.btnDisabled : ui.btnAccent} ${c.publish}`}
          disabled={!!blocker || preparing || notCreator}
          onClick={prepare}
          aria-live="polite"
        >
          {preparing ? 'Preparing…' : (blocker ?? (editSlug ? 'Propose edit' : 'Publish bucket'))}
        </button>
        <div style={{ fontSize: 12, color: 'var(--c-grey-500)', lineHeight: 1.5 }}>
          {editSlug
            ? 'Proposing writes the new weights on-chain as a pending version. After 24 hours anyone can activate it, and one keeper rebalance moves every holder at once.'
            : 'Publishing writes the recipe on-chain, creates the token mint and vault, mints your first tokens and returns a share link.'}{' '}
          By publishing you accept the <Link href="/legal/creator-terms">Creator terms</Link>.
        </div>
      </div>

      <ConfirmSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        kicker={editSlug ? 'PROPOSE EDIT' : 'PUBLISH'}
        action={editSlug ? `Propose an edit to ${editBucket?.name ?? 'this bucket'}` : `Publish ${draft.name.trim()}`}
        amountUsd={editSlug ? 0 : stake}
        amountCaption={editSlug ? 'Money moved by this transaction' : 'Your stake, minted into the first tokens'}
        rows={
          editSlug
            ? [
                { k: 'Holdings after the edit', v: `${draft.holdings.length} tokens` },
                { k: 'Takes effect', v: 'in 24 hours' },
                { k: 'Backers', v: 'notified now and when it lands' },
                { k: 'Next edit', v: 'after 7 days' },
                { k: 'Transactions to sign', v: String(built?.transactions.length ?? 1) },
              ]
            : [
                { k: 'Holdings', v: `${draft.holdings.length} tokens` },
                { k: 'Pre-IPO share', v: `${preShare}%` },
                { k: 'Unit price at launch', v: '$100.00' },
                { k: 'Commission', v: `${COMMISSION_PCT}% above high` },
                { k: 'Transactions to sign', v: String(built?.transactions.length ?? 1) },
              ]
        }
        note={
          editSlug
            ? 'Rent for any new vault token account this edit adds is charged to you, not to backers.'
            : 'Your stake is held like any backer’s: redeem it any time. Dropping below $25 removes the bucket from the leaderboard.'
        }
        confirmLabel={editSlug ? 'Confirm edit' : 'Confirm and publish'}
        working={working}
        error={sheetOpen ? error : null}
        onConfirm={confirm}
      />
      <PublishedModal
        published={published}
        onDone={() => {
          const slug = published?.slug;
          setPublished(null);
          if (slug) router.push(`/b/${slug}`);
        }}
      />
      <Modal open={!!proposed} onClose={() => setProposed(null)} labelledBy="proposed-title" width={480}>
        <div style={{ padding: '26px 22px' }}>
          <div style={{ width: 44, height: 44, background: 'var(--c-accent)', border: '1px solid var(--c-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }} aria-hidden="true">
            ✓
          </div>
          <h2 id="proposed-title" style={{ fontSize: 22, fontWeight: 700, margin: '14px 0 0' }}>
            Edit proposed
          </h2>
          <p style={{ fontSize: 14, color: 'var(--c-grey-700)', lineHeight: 1.55 }}>
            It takes effect in 24 hours. Until then the bucket page shows the change to everyone, and backers can exit before
            it lands.
          </p>
          <Link href={proposed ? `/b/${proposed.slug}` : '/'} className={`${ui.btn} ${ui.btnMedium}`} onClick={() => setProposed(null)}>
            Back to the bucket
          </Link>
        </div>
      </Modal>
    </div>
  );
}

/** Name and thesis edit (POST /v1/tx/update-info): immediate, no 24h delay, history untouched. */
function InfoEditor({ bucket }: { bucket: BucketDetail }) {
  const auth = useAuth();
  const { requireSignIn } = useSession();
  const [name, setName] = useState(bucket.name);
  const [thesis, setThesis] = useState(bucket.thesis);
  const [built, setBuilt] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [saved, setSaved] = useState(false);
  const changed = name.trim() !== bucket.name || thesis.trim() !== bucket.thesis;
  const invalid = !name.trim() ? 'Name your bucket' : bytes(name.trim()) > NAME_MAX_BYTES ? 'Name is too long' : null;

  const prepare = async () => {
    setError(null);
    setSaved(false);
    const wallet = await requireSignIn();
    if (!wallet) return;
    setPreparing(true);
    try {
      const api = await getApi();
      const res = await api.txUpdateInfo({ wallet, token: auth.getAccessToken }, { bucket: bucket.address, name: name.trim(), thesis: thesis.trim() });
      setBuilt(res.transaction);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPreparing(false);
    }
  };

  const confirm = async () => {
    if (!built || !auth.wallet) return;
    try {
      await signAndSubmit([built], { wallet: auth.wallet, token: auth.getAccessToken }, auth.signTransaction, (st) =>
        setWorking(st === 'signing' ? 'Waiting for your signature…' : 'Submitting…'),
      );
      setBuilt(null);
      setSaved(true);
      void refreshAfterTx();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setWorking(null);
    }
  };

  return (
    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <label htmlFor="info-name" className={ui.label}>
          Name
        </label>
        <input id="info-name" className={c.nameInput} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </div>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <label htmlFor="info-thesis" className={ui.label}>
            Thesis
          </label>
          <span className={c.counter}>
            {thesis.length} / {THESIS_MAX}
          </span>
        </div>
        <textarea
          id="info-thesis"
          className={c.thesisInput}
          rows={2}
          maxLength={THESIS_MAX}
          value={thesis}
          onChange={(e) => setThesis(e.target.value.slice(0, THESIS_MAX))}
        />
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className={changed && !invalid ? ui.btn : ui.btnDisabled} disabled={!changed || !!invalid || preparing} onClick={prepare}>
          {preparing ? 'Preparing…' : (invalid ?? 'Save name and thesis')}
        </button>
        {saved ? (
          <span className={ui.small} role="status">
            Saved on-chain.
          </span>
        ) : null}
        {error && !built ? (
          <span className={ui.small} role="alert">
            {error.message}
          </span>
        ) : null}
      </div>
      <ConfirmSheet
        open={!!built}
        onClose={() => setBuilt(null)}
        kicker="UPDATE INFO"
        action={`Rename to ${name.trim()}`}
        amountUsd={0}
        amountCaption="Money moved by this transaction"
        rows={[
          { k: 'Name', v: name.trim() },
          { k: 'Thesis', v: `${thesis.trim().length} characters` },
          { k: 'Weights and history', v: 'unchanged' },
        ]}
        confirmLabel="Confirm update"
        working={working}
        error={built ? error : null}
        onConfirm={confirm}
      />
    </div>
  );
}

function PublishedModal({
  published,
  onDone,
}: {
  published: { name: string; stake: number; slug: string; order: string | null; metadataPending?: boolean } | null;
  onDone: () => void;
}) {
  const { copied, copy } = useCopy();
  const link = published ? shareLink(published.slug) : null;
  // The creator's first mint fills like any other; show its progress when the backend returns the order.
  const { order } = useOrder(published?.order ?? null);
  const filled = order ? order.legs.filter((l) => l.status === 'filled').length : 0;
  return (
    <Modal open={!!published} onClose={onDone} labelledBy="published-title" width={520}>
      {published && link ? (
        <div style={{ padding: '26px 22px' }}>
          <div style={{ width: 44, height: 44, background: 'var(--c-accent)', border: '1px solid var(--c-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }} aria-hidden="true">
            ✓
          </div>
          <h2 id="published-title" style={{ fontSize: 22, fontWeight: 700, margin: '14px 0 0' }}>
            {published.name} is live
          </h2>
          {published.metadataPending ? (
            <p style={{ fontSize: 13, color: 'var(--c-grey-700)', margin: '8px 0 0', lineHeight: 1.5 }}>
              Its name and ticker will show up in wallets shortly — that last step finishes in the background.
            </p>
          ) : null}
          <p style={{ fontSize: 14, color: 'var(--c-grey-700)', margin: '8px 0 0', lineHeight: 1.55 }}>
            Recipe written on-chain, token mint and vault created, and your {usd(published.stake, 0)} is minting into the first
            tokens.
          </p>
          {published.order ? (
            <p className={ui.small} role="status" style={{ marginTop: 6 }}>
              {isFinished(order)
                ? 'Your first tokens are in your wallet.'
                : `Your first tokens are filling${order ? `: ${filled} of ${order.legs.length} legs done` : ''}.`}
            </p>
          ) : null}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--c-ink)', padding: '11px 14px', marginTop: 16 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{link.display}</span>
            <button type="button" className={ui.btnAccent} onClick={() => copy(link.href)} data-autofocus>
              <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
          <button type="button" className={`${ui.btn} ${ui.btnMedium}`} style={{ marginTop: 16 }} onClick={onDone}>
            Done
          </button>
        </div>
      ) : null}
    </Modal>
  );
}
