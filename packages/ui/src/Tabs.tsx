'use client';

import * as RadixTabs from '@radix-ui/react-tabs';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from 'react';

import { cn } from './lib/cn.js';
import { controlSizeStyles } from './lib/sizes.js';
import type { ControlSize } from './lib/sizes.js';

export const Tabs = RadixTabs.Root;

export type TabsListProps = ComponentPropsWithoutRef<typeof RadixTabs.List>;

export const TabsList = forwardRef<
  ElementRef<typeof RadixTabs.List>,
  TabsListProps
>(({ className, ...rest }, ref) => (
  <RadixTabs.List
    ref={ref}
    className={cn(
      'flex gap-0.5 rounded-md bg-surface-high p-0.5',
      className,
    )}
    {...rest}
  />
));

TabsList.displayName = 'TabsList';

export type TabsSize = ControlSize;

export type TabsTriggerProps = ComponentPropsWithoutRef<typeof RadixTabs.Trigger> & {
  size?: TabsSize;
};

const triggerSizeStyles: Record<TabsSize, string> = {
  sm: `${controlSizeStyles.sm} px-2`,
  md: `${controlSizeStyles.md} px-2.5`,
  lg: `${controlSizeStyles.lg} px-3`,
};

export const TabsTrigger = forwardRef<
  ElementRef<typeof RadixTabs.Trigger>,
  TabsTriggerProps
>(({ className, size = 'md', ...rest }, ref) => (
  <RadixTabs.Trigger
    ref={ref}
    className={cn(
      'inline-flex items-center gap-1.5 rounded-md',
      'font-medium text-foreground-tertiary',
      'transition-colors duration-fast',
      'hover:text-foreground-secondary',
      'data-[state=active]:bg-primary data-[state=active]:text-primary-foreground',
      'data-[state=active]:shadow-sm',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      triggerSizeStyles[size],
      className,
    )}
    {...rest}
  />
));

TabsTrigger.displayName = 'TabsTrigger';

export type TabsContentProps = ComponentPropsWithoutRef<typeof RadixTabs.Content>;

export const TabsContent = forwardRef<
  ElementRef<typeof RadixTabs.Content>,
  TabsContentProps
>(({ className, ...rest }, ref) => (
  <RadixTabs.Content
    ref={ref}
    className={cn(
      // `data-[state=inactive]:hidden` keeps an inactive panel collapsed even when
      // a caller passes a `display` utility (e.g. `flex` for a full-height table
      // tab). Radix hides inactive panels with the bare `hidden` attribute, but
      // `[hidden]{display:none}` (specificity 0,1,0) loses the tie to a `.flex`
      // utility — leaving phantom panels that push the active one off-screen. The
      // attribute-qualified selector here (0,2,0) wins, so inactive panels stay
      // `display:none` regardless of the utilities layered on.
      'mt-0 data-[state=inactive]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      className,
    )}
    {...rest}
  />
));

TabsContent.displayName = 'TabsContent';
