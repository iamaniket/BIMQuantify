'use client';

import { memo, type JSX } from 'react';

export type CheckState = 'on' | 'off' | 'mixed';

type TriCheckboxProps = {
  state: CheckState;
  onChange: () => void;
  size?: number; // eslint-disable-line no-restricted-syntax -- optional with default value
};

function TriCheckboxInner({
  state,
  onChange,
  size = 16,
}: TriCheckboxProps): JSX.Element {
  const isOn = state === 'on';
  const isMixed = state === 'mixed';
  const filled = isOn || isMixed;

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isMixed ? 'mixed' : isOn}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className="inline-grid shrink-0 cursor-pointer place-items-center rounded-[3px] border-[1.25px] p-0 transition-colors duration-[120ms]"
      style={{
        width: size,
        height: size,
        borderColor: filled ? 'var(--primary)' : 'var(--border)',
        background: filled ? 'var(--primary)' : 'var(--surface-main)',
      }}
    >
      {isOn && (
        <svg
          width={size - 4}
          height={size - 4}
          viewBox="0 0 12 12"
          fill="none"
          stroke="#fff"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="2.5,6.5 5,9 9.5,3.5" />
        </svg>
      )}
      {isMixed && (
        <span
          aria-hidden="true"
          className="rounded-[1px]"
          style={{ width: size - 6, height: 2.25, background: '#fff' }}
        />
      )}
    </button>
  );
}

export const TriCheckbox = memo(TriCheckboxInner);
