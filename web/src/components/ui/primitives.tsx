'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Period, Source } from '@/lib/api/types';
import { PERIODS, PERIOD_LABEL } from '@/lib/api/types';
import ui from './ui.module.css';

export function Label({
  children,
  as: Tag = 'div',
  id,
  style,
}: {
  children: ReactNode;
  as?: 'div' | 'span' | 'h2' | 'h3';
  id?: string;
  style?: CSSProperties;
}) {
  return (
    <Tag className={ui.label} id={id} style={{ margin: 0, ...style }}>
      {children}
    </Tag>
  );
}

export function PeriodSwitch({
  value,
  onChange,
  label = 'Period',
  periods = PERIODS,
}: {
  value: Period;
  onChange: (p: Period) => void;
  label?: string;
  periods?: Period[];
}) {
  return (
    <div className={ui.switch} role="group" aria-label={label}>
      {periods.map((p) => (
        <button key={p} type="button" aria-pressed={value === p} onClick={() => onChange(p)}>
          {PERIOD_LABEL[p]}
        </button>
      ))}
    </div>
  );
}

export function Kpi({
  label,
  value,
  sub,
  accent,
  mono,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: boolean;
  mono?: boolean;
}) {
  return (
    <div className={accent ? ui.kpiAccent : ui.kpi}>
      <div className={ui.label}>{label}</div>
      <div className={mono ? ui.kpiValueMono : ui.kpiValue}>{value}</div>
      {sub ? <div className={ui.kpiSub}>{sub}</div> : null}
    </div>
  );
}

export function SourceBadge({ source }: { source: Source }) {
  return <span className={source === 'xStocks' ? ui.badgeX : ui.badgePre}>{source}</span>;
}

export function PreIpoLabel() {
  return (
    <span className={ui.badgeFlag} style={{ fontSize: 9, padding: '2px 5px', letterSpacing: '0.05em' }}>
      PRE-IPO
    </span>
  );
}

export function XVerified() {
  return (
    <span className={ui.badgeFlag} title="X handle linked and verified through Privy">
      X VERIFIED
    </span>
  );
}

export function StatusBadge({ status }: { status: 'open' | 'closed' }) {
  return <span className={status === 'open' ? ui.statusOpen : ui.statusClosed}>{status === 'open' ? 'Open' : 'Closed'}</span>;
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={ui.toggle}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function useCopy(timeout = 1400) {
  const [copied, setCopied] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (t.current) clearTimeout(t.current);
    },
    [],
  );
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } finally {
        ta.remove();
      }
    }
    setCopied(true);
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => setCopied(false), timeout);
  };
  return { copied, copy };
}

export function CopyButton({
  text,
  className,
  label = 'Copy',
  ariaLabel,
}: {
  text: string;
  className?: string;
  label?: string;
  ariaLabel?: string;
}) {
  const { copied, copy } = useCopy();
  return (
    <button type="button" className={className ?? ui.btn} onClick={() => copy(text)} aria-label={ariaLabel}>
      <span aria-live="polite">{copied ? 'Copied' : label}</span>
    </button>
  );
}

export function Bar({ pct, accent, height = 6 }: { pct: number; accent?: boolean; height?: number }) {
  return (
    <div className={ui.track} style={{ height }}>
      <div className={accent ? ui.fillAccent : ui.fill} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

export function Skeleton({ w = '100%', h = 14 }: { w?: number | string; h?: number }) {
  return <div className={ui.skeleton} style={{ width: w, height: h }} aria-hidden="true" />;
}

export function ErrorNote({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className={ui.error} role="alert">
      {children}
      {action ? <div style={{ marginTop: 8 }}>{action}</div> : null}
    </div>
  );
}
