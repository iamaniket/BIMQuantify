'use client';

import * as RadixTabs from '@radix-ui/react-tabs';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from 'react';

import { cn } from './lib/cn.js';

export const Tabs = RadixTabs.Root;

export type TabsListProps = ComponentPropsWithoutRef<typeof RadixTabs.List>;

export const TabsList = forwardRef<
  ElementRef<typeof RadixTabs.List>,
  TabsListProps
>(({ className, ...rest }, ref) => (
  <RadixTabs.List
    ref={ref}
    className={cn(
      'flex gap-1 rounded-lg bg-surface-high p-1',
      className,
    )}
    {...rest}
  />
));

TabsList.displayName = 'TabsList';

export type TabsTriggerProps = ComponentPropsWithoutRef<typeof RadixTabs.Trigger>;

export const TabsTrigger = forwardRef<
  ElementRef<typeof RadixTabs.Trigger>,
  TabsTriggerProps
>(({ className, ...rest }, ref) => (
  <RadixTabs.Trigger
    ref={ref}
    className={cn(
      'inline-flex items-center gap-2 rounded-md px-3 py-1.5',
      'text-body3 font-semibold text-foreground-tertiary',
      'transition-colors duration-fast',
      'hover:text-foreground-secondary',
      'data-[state=active]:bg-primary data-[state=active]:text-primary-foreground',
      'data-[state=active]:shadow-sm',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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
      'mt-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      className,
    )}
    {...rest}
  />
));

TabsContent.displayName = 'TabsContent';
