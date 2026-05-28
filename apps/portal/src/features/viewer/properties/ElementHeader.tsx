'use client';

import type { JSX } from 'react';

type ElementHeaderProps = {
  name: string | null;
  type: string;
  globalId: string | null;
  selectionCount?: number;
};

export function ElementHeader({
  name,
  type,
  globalId,
  selectionCount,
}: ElementHeaderProps): JSX.Element {
  const multi = selectionCount !== undefined && selectionCount > 1;
  return (
    <div
      className="border-b border-border"
      style={{
        padding: '12px 14px 10px',
        background: 'var(--surface-main)',
      }}
    >
      {/* Eyebrow: IFC class chip + SELECTED badge */}
      <div
        className="flex items-center gap-2"
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 10.5,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--fg-3)',
          marginBottom: 6,
        }}
      >
        <span style={{ color: 'var(--fg-2)', fontWeight: 700 }}>{type}</span>
        <span
          style={{
            padding: '1px 6px',
            borderRadius: 3,
            background: 'var(--primary-light)',
            color: 'var(--primary)',
            fontWeight: 700,
            letterSpacing: '0.08em',
            fontSize: 10,
          }}
        >
          {multi ? `${selectionCount} SELECTED` : 'SELECTED'}
        </span>
      </div>

      {/* Element name */}
      <div
        className="truncate leading-tight"
        style={{
          fontFamily: 'var(--sans)',
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--fg)',
          letterSpacing: '-0.01em',
          marginBottom: globalId !== null ? 4 : 0,
        }}
      >
        {name ?? 'Unnamed'}
      </div>

      {/* GlobalId */}
      {globalId !== null && (
        <div
          className="truncate"
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 11,
            color: 'var(--fg-3)',
            letterSpacing: 0,
            lineHeight: 1.2,
          }}
        >
          {globalId}
        </div>
      )}
    </div>
  );
}
