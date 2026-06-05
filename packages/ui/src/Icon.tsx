import type { JSX } from 'react';

import type { Icon as PhosphorIcon, IconProps as PhosphorIconProps, IconWeight } from '@phosphor-icons/react';

import { cn } from './lib/cn.js';
import { DEFAULT_ICON_WEIGHT } from './lib/icons.js';

export const iconSizeClassNames = {
  xs: 'h-3.5 w-3.5',
  sm: 'h-4 w-4',
  md: 'h-[18px] w-[18px]',
  lg: 'h-[22px] w-[22px]',
  xl: 'h-7 w-7',
} as const;

export type IconSize = keyof typeof iconSizeClassNames;

export type IconProps = Omit<PhosphorIconProps, 'size' | 'weight'> & {
  icon: PhosphorIcon;
  size?: IconSize;
  weight?: IconWeight;
};

export function Icon({
  icon: PhosphorSvg,
  size = 'md',
  weight = DEFAULT_ICON_WEIGHT,
  className,
  ...rest
}: IconProps): JSX.Element {
  return (
    <PhosphorSvg
      aria-hidden
      weight={weight}
      className={cn('shrink-0', iconSizeClassNames[size], className)}
      {...rest}
    />
  );
}
