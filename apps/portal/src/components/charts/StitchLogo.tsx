import type { JSX } from 'react';

type Props = {
  size?: number;
  color?: string;
  className?: string;
};

export function StitchLogo({
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
      <rect x="3" y="3" width="18" height="18" rx="3" stroke={color} strokeWidth="1.6" />
      <path d="M3 12 L21 12" stroke={color} strokeWidth="1.6" strokeDasharray="2.2 2.2" />
      <path d="M12 3 L12 21" stroke={color} strokeWidth="1.6" strokeDasharray="2.2 2.2" />
      <circle cx="12" cy="12" r="2.2" fill={color} />
    </svg>
  );
}
