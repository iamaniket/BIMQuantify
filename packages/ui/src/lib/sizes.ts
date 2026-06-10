/**
 * Shared control size scale used across all interactive UI controls.
 *
 * This three-tier system ensures consistent height and typography across:
 * - Buttons, IconButtons, Input fields, Select dropdowns
 * - Tabs, DropdownMenuItems, Sidebar navigation items
 * - Any other clickable/interactive control
 *
 * @example
 * // Use directly for components with no additional padding needs
 * const sizeStyles = controlSizeStyles;
 *
 * @example
 * // Extend with component-specific padding
 * const sizeStyles: Record<ControlSize, string> = {
 *   sm: `${controlSizeStyles.sm} px-2`,
 *   md: `${controlSizeStyles.md} px-3`,
 *   lg: `${controlSizeStyles.lg} px-4`,
 * };
 */
export type ControlSize = 'sm' | 'md' | 'lg';

/**
 * Height + font-size classes for each control size.
 *
 * Individual components add their own padding/spacing on top of these base styles.
 *
 * Size scale:
 * - `sm`: h-6 (28px) + text-[12px] — compact controls, dense UIs
 * - `md`: h-7.5 (30px) + text-[14px] — default for most controls
 * - `lg`: h-8 (36px) + text-[16px] — prominent actions, accessibility
 *
 * @see Button.tsx - extends with horizontal padding
 * @see Input.tsx - extends with horizontal padding + icon spacing
 * @see Tabs.tsx - extends with horizontal padding for triggers
 */
export const controlSizeStyles: Record<ControlSize, string> = {
  sm: 'h-6 text-[12px]',
  md: 'h-[30px] text-[14px]',
  lg: 'h-8 text-[16px]',
};
