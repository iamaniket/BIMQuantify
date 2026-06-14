'use client';

import {
  forwardRef, useEffect, useRef, type InputHTMLAttributes,
} from 'react';

import { cn } from './lib/cn.js';

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** Renders the "mixed" dash and fills the box — for select-all parents. */
  indeterminate?: boolean;
};

/**
 * Custom-rendered checkbox: an `appearance-none` native input (so it stays
 * form- and a11y-correct, controlled or uncontrolled) painted as a rounded
 * primary-fill box, with a white check (CSS `:checked`) or a dash overlay
 * (driven by the `indeterminate` prop, which is also reflected onto the DOM
 * node so assistive tech announces "mixed").
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, indeterminate = false, ...rest }, ref) => {
    const innerRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
      if (innerRef.current !== null) innerRef.current.indeterminate = indeterminate;
    }, [indeterminate]);

    return (
      <span className="relative inline-grid size-[18px] shrink-0 place-items-center">
        <input
          ref={(node) => {
            innerRef.current = node;
            if (typeof ref === 'function') ref(node);
            else if (ref !== null) ref.current = node;
          }}
          type="checkbox"
          className={cn(
            'peer col-start-1 row-start-1 size-[18px] cursor-pointer appearance-none rounded'
            + ' border-[1.5px] bg-background transition-colors hover:border-primary'
            + ' checked:border-primary checked:bg-primary'
            + ' focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0'
            + ' disabled:cursor-not-allowed disabled:opacity-60',
            indeterminate ? 'border-primary bg-primary' : 'border-border-hover',
            className,
          )}
          {...rest}
        />
        {/* check — shown via the input's :checked state */}
        <svg
          className="pointer-events-none col-start-1 row-start-1 hidden size-[11px] text-primary-foreground peer-checked:block"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={3.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12.5l4.5 4.5L19 6.5" />
        </svg>
        {/* dash — shown when explicitly indeterminate */}
        {indeterminate && (
          <svg
            className="pointer-events-none col-start-1 row-start-1 size-[11px] text-primary-foreground"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={3.6}
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 12h12" />
          </svg>
        )}
      </span>
    );
  },
);

Checkbox.displayName = 'Checkbox';
