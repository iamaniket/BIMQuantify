import type { JSX } from 'react';

type Props = {
  size?: number;
  color?: string;
  className?: string;
};

/**
 * BimDossier logomark — "BD" wordmark matching the favicons and sidebar footer.
 */
export function DossierLogo({
  size = 22,
  color = 'currentColor',
  className,
}: Props): JSX.Element {
  const fontSize = Math.round(size * 0.78);
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        color,
        fontFamily:
          "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        fontWeight: 700,
        fontSize,
        lineHeight: 1,
        letterSpacing: -0.5,
      }}
    >
      BD
    </span>
  );
}

/** @deprecated Use `DossierLogo` instead. */
export const StitchLogo = DossierLogo;
