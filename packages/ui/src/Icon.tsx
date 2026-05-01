import type { JSX } from 'react';

import type { LucideIcon, LucideProps } from 'lucide-react';

import { cn } from './lib/cn.js';

export const iconSizeClassNames = {
  xs: 'h-3 w-3',
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-5 w-5',
  xl: 'h-6 w-6',
} as const;

export type IconSize = keyof typeof iconSizeClassNames;

export type IconProps = Omit<LucideProps, 'size'> & {
  icon: LucideIcon;
  size?: IconSize;
};

export function Icon({
  icon: LucideSvg,
  size = 'md',
  className,
  ...rest
}: IconProps): JSX.Element {
  return (
    <LucideSvg
      aria-hidden
      className={cn('shrink-0', iconSizeClassNames[size], className)}
      {...rest}
    />
  );
}