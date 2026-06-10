'use client';

import * as RadixDropdown from '@radix-ui/react-dropdown-menu';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from 'react';

import { cn } from './lib/cn.js';
import { controlSizeStyles } from './lib/sizes.js';
import type { ControlSize } from './lib/sizes.js';

export const DropdownMenu = RadixDropdown.Root;
export const DropdownMenuTrigger = RadixDropdown.Trigger;

const contentStyles =
  'z-50 min-w-[10rem] overflow-hidden rounded-md border border-border bg-background p-1 shadow-md';

export type DropdownMenuContentProps = ComponentPropsWithoutRef<typeof RadixDropdown.Content>;

export const DropdownMenuContent = forwardRef<
  ElementRef<typeof RadixDropdown.Content>,
  DropdownMenuContentProps
>(({ className, sideOffset = 4, align = 'end', ...rest }, ref) => (
  <RadixDropdown.Portal>
    <RadixDropdown.Content
      ref={ref}
      sideOffset={sideOffset}
      align={align}
      className={cn(contentStyles, className)}
      {...rest}
    />
  </RadixDropdown.Portal>
));

DropdownMenuContent.displayName = 'DropdownMenuContent';

export type DropdownMenuItemSize = ControlSize;

export type DropdownMenuItemVariant = 'default' | 'destructive';

export type DropdownMenuItemProps = ComponentPropsWithoutRef<typeof RadixDropdown.Item> & {
  variant?: DropdownMenuItemVariant;
  size?: DropdownMenuItemSize;
};

const itemBaseStyles =
  'flex cursor-pointer select-none items-center gap-2 rounded-sm outline-none '
  + 'data-[disabled]:cursor-not-allowed data-[disabled]:text-foreground-disabled';

const itemSizeStyles: Record<DropdownMenuItemSize, string> = {
  sm: `${controlSizeStyles.sm} px-2 py-1`,
  md: `${controlSizeStyles.md} px-2 py-1.5`,
  lg: `${controlSizeStyles.lg} px-2 py-2`,
};

const itemVariantStyles: Record<DropdownMenuItemVariant, string> = {
  default:
    'text-foreground data-[highlighted]:bg-background-hover data-[highlighted]:text-foreground',
  destructive:
    'text-error data-[highlighted]:bg-error-lighter data-[highlighted]:text-error',
};

export const DropdownMenuItem = forwardRef<
  ElementRef<typeof RadixDropdown.Item>,
  DropdownMenuItemProps
>(({ className, variant = 'default', size = 'md', ...rest }, ref) => (
  <RadixDropdown.Item
    ref={ref}
    className={cn(itemBaseStyles, itemSizeStyles[size], itemVariantStyles[variant], className)}
    {...rest}
  />
));

DropdownMenuItem.displayName = 'DropdownMenuItem';

export type DropdownMenuSeparatorProps = ComponentPropsWithoutRef<typeof RadixDropdown.Separator>;

export const DropdownMenuSeparator = forwardRef<
  ElementRef<typeof RadixDropdown.Separator>,
  DropdownMenuSeparatorProps
>(({ className, ...rest }, ref) => (
  <RadixDropdown.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-border', className)}
    {...rest}
  />
));

DropdownMenuSeparator.displayName = 'DropdownMenuSeparator';

export type DropdownMenuLabelProps = ComponentPropsWithoutRef<typeof RadixDropdown.Label>;

export const DropdownMenuLabel = forwardRef<
  ElementRef<typeof RadixDropdown.Label>,
  DropdownMenuLabelProps
>(({ className, ...rest }, ref) => (
  <RadixDropdown.Label
    ref={ref}
    className={cn('px-2 py-1.5 text-caption font-medium text-foreground-tertiary', className)}
    {...rest}
  />
));

DropdownMenuLabel.displayName = 'DropdownMenuLabel';
