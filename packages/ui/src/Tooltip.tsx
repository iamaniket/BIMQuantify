'use client';

import * as RadixTooltip from '@radix-ui/react-tooltip';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from 'react';

import { cn } from './lib/cn.js';

export const TooltipProvider = RadixTooltip.Provider;
export const Tooltip = RadixTooltip.Root;
export const TooltipTrigger = RadixTooltip.Trigger;

export type TooltipContentProps = ComponentPropsWithoutRef<typeof RadixTooltip.Content>;

export const TooltipContent = forwardRef<
  ElementRef<typeof RadixTooltip.Content>,
  TooltipContentProps
>(({ className, sideOffset = 6, ...rest }, ref) => (
  <RadixTooltip.Portal>
    <RadixTooltip.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 rounded-md bg-surface-inverse px-2.5 py-1.5',
        'text-caption font-medium text-foreground-inverse',
        'shadow-md animate-in fade-in-0 zoom-in-95',
        className,
      )}
      {...rest}
    />
  </RadixTooltip.Portal>
));

TooltipContent.displayName = 'TooltipContent';
