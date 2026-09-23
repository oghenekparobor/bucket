'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { ErrorNote } from '@/components/ui/primitives';
import ui from '@/components/ui/ui.module.css';
import type { FriendlyError } from '@/lib/txFlow';
import { usd } from '@/lib/format';
import m from './modals.module.css';

/**
 * The in-app confirmation sheet shown for a transaction the backend has already built: it states
 * the action and the USD amount before the wallet is asked to sign (design: "Confirm investment").
 */
export function ConfirmSheet({
  open,
  onClose,
  kicker = 'CONFIRM',
  action,
  amountUsd,
  amountCaption,
  rows,
  note,
  confirmLabel = 'Confirm',
  working,
  error,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  kicker?: string;
  /** The action in words, e.g. "Publish Picks & Shovels". */
  action: string;
  amountUsd: string | number;
  amountCaption: string;
  rows: { k: string; v: ReactNode }[];
  note?: ReactNode;
  confirmLabel?: string;
  /** Progress text while signing/submitting; locks the sheet. */
  working: string | null;
  error: FriendlyError | null;
  onConfirm: () => void;
}) {
  const titleId = 'confirm-sheet-title';
  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId} width={460} locked={!!working}>
      <ModalHeader kicker={kicker} title={action} titleId={titleId} onClose={onClose} closeDisabled={!!working} />
      <div className={m.body}>
        <div className={ui.label}>{amountCaption}</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 40, fontWeight: 500, marginTop: 6 }}>{usd(amountUsd)}</div>
        <div className={ui.rows} style={{ marginTop: 16, borderTop: '1px solid var(--c-line)', paddingTop: 14 }}>
          {rows.map((r) => (
            <div key={r.k} className={ui.row}>
              <span>{r.k}</span>
              <span>{r.v}</span>
            </div>
          ))}
        </div>
        {note ? (
          <div className={ui.noticeAccent} style={{ marginTop: 14, fontSize: 12 }}>
            {note}
          </div>
        ) : null}
        {error ? (
          <div style={{ marginTop: 14 }}>
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
          </div>
        ) : null}
        <button
          type="button"
          className={`${working ? ui.btnDisabled : ui.btnAccent} ${ui.btnLarge} ${m.confirm}`}
          onClick={onConfirm}
          disabled={!!working}
          aria-live="polite"
          data-autofocus
        >
          {working ?? confirmLabel}
        </button>
        <div className={m.foot}>Network fee sponsored</div>
      </div>
    </Modal>
  );
}
