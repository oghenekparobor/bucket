'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { TERMS_VERSION, useSession } from '@/auth/SessionProvider';
import { CopyButton, ErrorNote, Label, XVerified } from '@/components/ui/primitives';
import { QrCode } from '@/components/ui/QrCode';
import ui from '@/components/ui/ui.module.css';
import { useCaller, useMe } from '@/hooks/api';
import { getApi } from '@/lib/api';
import { config, explorerUrl } from '@/lib/config';
import { dateLong, num, usd, usdOr } from '@/lib/format';
import { friendlyError } from '@/lib/txFlow';
import { SignInGate } from './SignInGate';
import v from './views.module.css';

export function AccountView() {
  return (
    <SignInGate what="your account">
      <Account />
    </SignInGate>
  );
}

function Account() {
  const auth = useAuth();
  const { termsAcceptedAt } = useSession();
  const me = useMe();
  const caller = useCaller();
  const wallet = auth.wallet!;
  const [faucet, setFaucet] = useState<{ busy: boolean; msg: string | null }>({ busy: false, msg: null });
  const [secret, setSecret] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [emailState, setEmailState] = useState<{ busy: boolean; msg: string | null }>({ busy: false, msg: null });
  const [fundErr, setFundErr] = useState<string | null>(null);

  useEffect(() => {
    if (me.data?.email) setEmail(me.data.email);
  }, [me.data?.email]);

  useEffect(() => {
    if (window.location.hash === '#add-funds') document.getElementById('add-funds')?.scrollIntoView({ block: 'start' });
  }, []);

  const xHandle = me.data?.xHandle ?? auth.xHandle;
  const xVerified = me.data?.xVerified ?? false;
  const solanaPay = config.usdcMint ? `solana:${wallet}?spl-token=${config.usdcMint}&label=Bucket` : null;

  const runFaucet = async () => {
    if (!caller) return;
    setFaucet({ busy: true, msg: null });
    try {
      const api = await getApi();
      const res = await api.faucet(caller);
      await me.mutate();
      setFaucet({ busy: false, msg: `Sent ${res.amountUsd ? usd(res.amountUsd) : 'test'} USDC to your wallet.` });
    } catch (e) {
      setFaucet({ busy: false, msg: friendlyError(e).message });
    }
  };

  const saveEmail = async (e: FormEvent) => {
    e.preventDefault();
    if (!caller) return;
    setEmailState({ busy: true, msg: null });
    try {
      const api = await getApi();
      await api.setNotifications(caller, { email: email.trim() });
      await me.mutate();
      setEmailState({ busy: false, msg: 'Saved. Edit notices and payouts will reach this address.' });
    } catch (err) {
      setEmailState({ busy: false, msg: friendlyError(err).message });
    }
  };

  return (
    <div className={v.acctGrid}>
      <section className={ui.card} aria-labelledby="wallet-title">
        <div className={ui.cardHead}>
          <h2 id="wallet-title" className={ui.cardTitle}>
            Wallet
          </h2>
          <span style={{ fontSize: 12, color: 'var(--c-grey-500)' }}>{auth.walletLabel}</span>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <Label>Address</Label>
            <div className={v.fieldRow} style={{ marginTop: 6 }}>
              <span className={v.addr}>{wallet}</span>
              <CopyButton text={wallet} ariaLabel="Copy wallet address" />
            </div>
            <a href={explorerUrl('address', wallet)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, display: 'inline-block', marginTop: 6 }}>
              View on Solana Explorer
            </a>
          </div>
          <div className={ui.rows}>
            <div className={ui.row}>
              <span>USDC balance</span>
              <span style={{ fontWeight: 600 }}>{usdOr(me.data?.usdcBalance)}</span>
            </div>
            <div className={ui.row}>
              <span>SOL balance</span>
              <span>{me.data?.solBalance != null ? `${num(me.data.solBalance).toFixed(4)} SOL` : '—'}</span>
            </div>
          </div>
          <div className={ui.small}>Fees sponsored · no SOL needed. Bucket never holds your key or your money.</div>
          {me.error ? <ErrorNote>Could not load balances. {(me.error as Error).message}</ErrorNote> : null}
        </div>
      </section>

      <section id="add-funds" className={ui.card} aria-labelledby="funds-title" style={{ scrollMarginTop: 16 }}>
        <div className={ui.cardHead}>
          <h2 id="funds-title" className={ui.cardTitle}>
            Add funds
          </h2>
          <span style={{ fontSize: 12, color: 'var(--c-grey-500)' }}>USDC on Solana</span>
        </div>
        <div style={{ padding: 18, display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ border: '1px solid var(--c-line)', padding: 8, background: 'var(--c-card)' }}>
            <QrCode value={wallet} size={148} label="QR code of your deposit address" />
          </div>
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <div className={v.optionTitle}>Deposit address</div>
            <div className={ui.small} style={{ marginTop: 4 }}>
              Send USDC on Solana to this address. Other tokens or other networks can be lost.
            </div>
            <div className={v.fieldRow} style={{ marginTop: 10 }}>
              <span className={v.addr} style={{ fontSize: 12 }}>
                {wallet}
              </span>
              <CopyButton text={wallet} ariaLabel="Copy deposit address" />
            </div>
          </div>
        </div>
        <div className={v.option}>
          <div className={v.optionText}>
            <div className={v.optionTitle}>Transfer from an external wallet</div>
            <div className={ui.small}>
              In Phantom, Solflare, Backpack or an exchange, send USDC (Solana network) to the deposit address above.
            </div>
          </div>
          {solanaPay ? (
            <a href={solanaPay} className={ui.btn}>
              Open in wallet
            </a>
          ) : null}
        </div>
        {auth.fundWallet ? (
          <div className={v.option}>
            <div className={v.optionText}>
              <div className={v.optionTitle}>Card or bank</div>
              <div className={ui.small}>Buy USDC through Privy&apos;s funding providers. They run their own checks.</div>
              {fundErr ? <div className={ui.small} role="alert">{fundErr}</div> : null}
            </div>
            <button
              type="button"
              className={ui.btnAccent}
              onClick={() => {
                setFundErr(null);
                auth.fundWallet?.().catch((e) => setFundErr(friendlyError(e).message));
              }}
            >
              Buy USDC
            </button>
          </div>
        ) : null}
        {config.cluster === 'devnet' ? (
          <div className={v.option}>
            <div className={v.optionText}>
              <div className={v.optionTitle}>Devnet faucet</div>
              <div className={ui.small}>Test USDC for the devnet preview. It has no value.</div>
              {faucet.msg ? (
                <div className={ui.small} role="status" style={{ color: 'var(--c-ink)' }}>
                  {faucet.msg}
                </div>
              ) : null}
            </div>
            <button type="button" className={ui.btnAccent} onClick={runFaucet} disabled={faucet.busy}>
              {faucet.busy ? 'Sending…' : 'Get test USDC'}
            </button>
          </div>
        ) : null}
      </section>

      <section className={ui.card} aria-labelledby="key-title">
        <div className={ui.cardHead}>
          <h2 id="key-title" className={ui.cardTitle}>
            Your key
          </h2>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
            Export your key at any time and use it in any Solana wallet. With it you can redeem your bucket tokens even if
            Bucket, Privy or this app is offline.
          </p>
          {auth.exportKey ? (
            <button type="button" className={`${ui.btn} ${ui.btnMedium}`} onClick={() => void auth.exportKey?.()}>
              Export private key
            </button>
          ) : null}
          {auth.revealDevSecret ? (
            secret ? (
              <>
                <div className={v.secret}>{secret}</div>
                <div className={v.fieldRow}>
                  <CopyButton text={secret} label="Copy secret key" />
                  <button type="button" className={ui.btn} onClick={() => setSecret(null)}>
                    Hide
                  </button>
                </div>
                <div className={ui.small}>Anyone with this key controls the wallet. Base58, importable into Phantom.</div>
              </>
            ) : (
              <button type="button" className={`${ui.btn} ${ui.btnMedium}`} onClick={() => setSecret(auth.revealDevSecret!())}>
                Reveal dev secret key
              </button>
            )
          ) : null}
          {auth.walletKind === 'external' ? (
            <div className={ui.small}>Your key is held by {auth.walletLabel}. Export it from that wallet.</div>
          ) : null}
        </div>
      </section>

      <section className={ui.card} aria-labelledby="linked-title">
        <div className={ui.cardHead}>
          <h2 id="linked-title" className={ui.cardTitle}>
            Linked accounts
          </h2>
        </div>
        <div className={v.option} style={{ borderTop: 0 }}>
          <div className={v.optionText}>
            <div className={v.optionTitle}>X</div>
            <div className={ui.small} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 2 }}>
              {xHandle ? (
                <>
                  <span className={ui.mono}>{xHandle}</span>
                  {xVerified ? <XVerified /> : <span>linked, verification pending</span>}
                </>
              ) : (
                'Not linked. A linked handle shows as verified on your buckets and profile.'
              )}
            </div>
          </div>
          {!xHandle && auth.linkTwitter ? (
            <button type="button" className={ui.btn} onClick={() => auth.linkTwitter?.()}>
              Link X
            </button>
          ) : null}
          {!xHandle && !auth.linkTwitter ? <span className={ui.small}>Needs Privy (dev mode)</span> : null}
        </div>
        <form className={v.option} onSubmit={saveEmail}>
          <div className={v.optionText}>
            <label htmlFor="notify-email" className={v.optionTitle}>
              Email for notifications
            </label>
            <div className={ui.small}>Edit notices before they take effect, and commission payouts.</div>
            <input
              id="notify-email"
              type="email"
              className={ui.input}
              style={{ marginTop: 8 }}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
            {emailState.msg ? (
              <div className={ui.small} role="status" style={{ marginTop: 6 }}>
                {emailState.msg}
              </div>
            ) : null}
          </div>
          <button type="submit" className={ui.btnAccent} disabled={emailState.busy}>
            {emailState.busy ? 'Saving…' : me.data?.email ? 'Update' : 'Add email'}
          </button>
        </form>
      </section>

      <section className={ui.card} aria-labelledby="legal-title">
        <div className={ui.cardHead}>
          <h2 id="legal-title" className={ui.cardTitle}>
            Terms
          </h2>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
          <div>
            {termsAcceptedAt ? `Accepted on ${dateLong(termsAcceptedAt)} (version ${TERMS_VERSION}).` : 'Not accepted yet.'}
          </div>
          <div style={{ display: 'flex', gap: 14 }}>
            <Link href="/legal/terms">Terms of Service</Link>
            <Link href="/legal/risks">Risk disclosures</Link>
          </div>
          <button type="button" className={`${ui.btn} ${ui.btnMedium}`} onClick={() => void auth.logout()} style={{ marginTop: 8 }}>
            Sign out
          </button>
        </div>
      </section>
    </div>
  );
}
