'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import ui from './ui.module.css';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name when no visible title is referenced through `labelledBy`. */
  label?: string;
  labelledBy?: string;
  width?: number;
  /** 'sheet' = bottom sheet on phones (default); 'dark' = full-screen ink on phones (PnL card). */
  variant?: 'sheet' | 'dark';
  /** Blocks Escape/backdrop close while a transaction is in flight. */
  locked?: boolean;
  children: ReactNode;
}

/** Keyboard-operable dialog: focus trap, Escape to close, focus restored on close. */
export function Modal({ open, onClose, label, labelledBy, width = 520, variant = 'sheet', locked, children }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const lockedRef = useRef(locked);
  useEffect(() => {
    closeRef.current = onClose;
    lockedRef.current = locked;
  });

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!lockedRef.current) {
          e.stopPropagation();
          closeRef.current();
        }
        return;
      }
      if (e.key !== 'Tab' || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === firstEl || document.activeElement === node)) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prev?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div
      className={`${ui.scrim} ${variant === 'dark' ? ui.scrimDark : ''}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !lockedRef.current) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`${ui.dialog} ${variant === 'dark' ? ui.dark : ''}`}
        style={{ maxWidth: width }}
      >
        {variant === 'sheet' ? <div className={ui.handle} aria-hidden="true" /> : null}
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ModalHeader({
  kicker,
  title,
  titleId,
  onClose,
  closeDisabled,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  titleId: string;
  onClose: () => void;
  closeDisabled?: boolean;
}) {
  return (
    <div className={ui.dialogHead}>
      <div style={{ minWidth: 0 }}>
        {kicker ? <div className={ui.label}>{kicker}</div> : null}
        <h2 id={titleId} className={ui.dialogTitle}>
          {title}
        </h2>
      </div>
      <button type="button" className={ui.iconBtn} onClick={onClose} aria-label="Close" disabled={closeDisabled}>
        ×
      </button>
    </div>
  );
}
