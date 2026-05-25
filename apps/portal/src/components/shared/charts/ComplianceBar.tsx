'use client';

import type { JSX } from 'react';

type Props = {
  pass: number;
  warn: number;
  fail: number;
  height?: number;
  className?: string;
};

export function ComplianceBar({
  pass,
  warn,
  fail,
  height = 6,
  className,
}: Props): JSX.Element {
  const total = pass + warn + fail || 1;
  const pPass = (pass / total) * 100;
  const pWarn = (warn / total) * 100;
  const pFail = (fail / total) * 100;

  return (
    <div
      className={className}
      style={{ height, display: 'flex', borderRadius: 999, overflow: 'hidden' }}
    >
      <div className="bg-success" style={{ width: `${pPass}%` }} />
      <div className="bg-warning" style={{ width: `${pWarn}%` }} />
      <div className="bg-error" style={{ width: `${pFail}%` }} />
    </div>
  );
}
