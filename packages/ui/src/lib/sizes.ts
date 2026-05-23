/** Shared control size scale used by Button, Input, Select, etc. */
export type ControlSize = 'sm' | 'md' | 'lg';

/**
 * Height + font-size classes for each control size.
 * Individual components add their own padding on top.
 */
export const controlSizeStyles: Record<ControlSize, string> = {
  sm: 'h-8 text-[14px]',
  md: 'h-9 text-[14px]',
  lg: 'h-10 text-[16px]',
};
