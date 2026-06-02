import type { JSX } from 'react';

type Props = {
  size?: number;
  color?: string;
  className?: string;
};

/**
 * BimDossier logomark — a stylised open dossier/document with a checkmark,
 * matching the brand identity used in favicons and the sidebar footer.
 */
export function DossierLogo({
  size = 22,
  color = 'currentColor',
  className,
}: Props): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Document / dossier outline */}
      <path
        d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Folded corner */}
      <path
        d="M14 2v5h5"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Checkmark inside document */}
      <path
        d="M8.5 14 l2 2 l4.5-5"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** @deprecated Use `DossierLogo` instead. */
export const StitchLogo = DossierLogo;
