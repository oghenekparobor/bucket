'use client';

import { Modal, ModalHeader } from '@/components/ui/Modal';
import ui from '@/components/ui/ui.module.css';
import { useNow } from '@/hooks/useMediaQuery';
import type { BucketDetail } from '@/lib/api/types';
import { countdown } from '@/lib/format';
import m from './modals.module.css';

export function EditDiffModal({
  open,
  onClose,
  bucket,
  onExit,
}: {
  open: boolean;
  onClose: () => void;
  bucket: BucketDetail;
  onExit: () => void;
}) {
  const now = useNow(30_000);
  const pe = bucket.pendingEdit;
  if (!pe) return null;
  const titleId = 'edit-title';
  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId} width={560}>
      <ModalHeader
        kicker={`PENDING EDIT · V${pe.version}`}
        title={`Takes effect in ${countdown(pe.effectiveAt, now)}`}
        titleId={titleId}
        onClose={onClose}
      />
      <div className={m.body}>
        {pe.note ? <p style={{ fontSize: 14, lineHeight: 1.55, margin: 0 }}>{pe.note}</p> : null}
        <div className={m.diffHead} role="row">
          <div>TOKEN</div>
          <div style={{ textAlign: 'right' }}>NOW</div>
          <div style={{ textAlign: 'right' }}>AFTER</div>
          <div style={{ textAlign: 'right' }}>CHANGE</div>
        </div>
        {pe.diff.map((d) => {
          const from = d.fromPct ?? 0;
          const to = d.toPct ?? 0;
          const delta = to - from;
          const bg = delta > 0 ? 'var(--c-accent)' : delta < 0 ? 'var(--c-track)' : 'transparent';
          return (
            <div key={d.ticker} className={m.diffRow}>
              <div>{d.ticker}</div>
              <div style={{ textAlign: 'right', color: 'var(--c-grey-500)' }}>{d.fromPct === null ? '—' : `${d.fromPct}%`}</div>
              <div style={{ textAlign: 'right' }}>{d.toPct === null ? '—' : `${d.toPct}%`}</div>
              <div style={{ textAlign: 'right', fontSize: 12, background: bg, padding: '2px 6px' }}>
                {delta === 0 ? '—' : delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`}
              </div>
            </div>
          );
        })}
        <div className={ui.notice} style={{ marginTop: 16 }}>
          Every backer was notified when this was proposed and will be notified again when it lands. One keeper rebalance
          moves all holders at once, within a slippage bound per trade. At most one edit per 7 days.
        </div>
        <div className={m.btnRow} style={{ marginTop: 16 }}>
          <button type="button" className={`${ui.btn} ${ui.btnMedium}`} onClick={onClose}>
            Stay in
          </button>
          <button type="button" className={`${ui.btnAccent} ${ui.btnMedium}`} style={{ fontWeight: 700 }} onClick={onExit}>
            Exit before it lands
          </button>
        </div>
      </div>
    </Modal>
  );
}
