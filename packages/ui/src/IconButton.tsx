import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import type { Icon as PhosphorIcon } from '@phosphor-icons/react';

import { cn } from './lib/cn.js';
import { DEFAULT_ICON_WEIGHT } from './lib/icons.js';
import { controlSizeStyles } from './lib/sizes.js';
import type { ControlSize } from './lib/sizes.js';

export type IconButtonSize = ControlSize;

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

/**
 * IconButton uses controlSize heights for consistency with other controls,
 * but maintains square aspect ratio (width = height).
 */
const sizeStyles: Record<IconButtonSize, string> = {
  sm: `${controlSizeStyles.sm} w-7`,
  md: `${controlSizeStyles.md} w-8`,
  lg: `${controlSizeStyles.lg} w-9`,
};

/**
 * Icon sizes scaled proportionally to button size.
 * Maintains ~60-75% of button height for balanced visual weight.
 */
const iconSizeByButton: Record<IconButtonSize, string> = {
  sm: 'h-4 w-4',      // 16px in 24px button
  md: 'h-[18px] w-[18px]', // 18px in 30px button
  lg: 'h-6 w-6',      // 24px in 32px button
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
