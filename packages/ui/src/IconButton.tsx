import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import type { Icon as PhosphorIcon } from '@phosphor-icons/react';

import { cn } from './lib/cn.js';
import { DEFAULT_ICON_WEIGHT } from './lib/icons.js';

export type IconButtonSize = 'sm' | 'md' | 'lg';

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Icon component. Alternatively pass arbitrary `children` (e.g. an inline svg). */
  icon?: PhosphorIcon;
  size?: IconButtonSize;
  /** Highlights the button with the primary colour (e.g. an active toggle). */
  active?: boolean;
  /** Required for accessibility — icon-only buttons need a label. */
  'aria-label': string;
  children?: ReactNode;
};

const sizeStyles: Record<IconButtonSize, string> = {
  sm: 'h-6 w-6',
  md: 'h-[26px] w-[26px]',
  lg: 'h-8 w-8',
};

const iconSizeByButton: Record<IconButtonSize, string> = {
  sm: 'h-4 w-4',
  md: 'h-[18px] w-[18px]',
  lg: 'h-[26px] w-[26px]',
};

const baseStyles =
  'inline-grid shrink-0 cursor-pointer place-items-center rounded border border-transparent '
  + 'bg-transparent p-0 transition-colors duration-fast hover:bg-background-hover '
  + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring '
  + 'disabled:cursor-not-allowed disabled:text-foreground-disabled disabled:hover:bg-transparent';

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon: IconSvg, size = 'md', active = false, className, type, children, ...rest }, ref) => (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cn(
        baseStyles,
        sizeStyles[size],
        active ? 'text-primary' : 'text-foreground-tertiary',
        className,
      )}
      {...rest}
    >
      {IconSvg ? <IconSvg className={iconSizeByButton[size]} weight={DEFAULT_ICON_WEIGHT} aria-hidden /> : children}
    </button>
  ),
);

IconButton.displayName = 'IconButton';
