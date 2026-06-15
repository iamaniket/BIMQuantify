// Shared theme for the mobile app. React Native can't consume the CSS-variable
// pipeline the portal uses, so we read the design tokens' plain JS objects
// (`@bimstitch/design-tokens`) and flatten the subset the app needs into a single
// `colors` source of truth. Light theme only for now; dark can be added by
// swapping `lightTheme` for a theme-aware lookup later.
//
// Key-casing note (see packages/design-tokens/src/themes/light.ts): brand groups
// expose their base value as `DEFAULT` (primary.DEFAULT, success.DEFAULT, …),
// while neutral groups use lowercase `default` (foreground.default, border.default).
import { lightTheme as t } from '@bimstitch/design-tokens';

export const colors = {
  primary: t.primary.DEFAULT, // #2c5697
  primaryHover: t.primary.hover, // #244b86
  primaryActive: t.primary.active, // #1e3f72
  primaryLight: t.primary.light, // #e5ecf6
  primaryDark: t.primary.dark, // #172f54
  onPrimary: t.primary.foreground, // #ffffff
  onDark: '#ffffff',

  text: t.foreground.default, // #0f172a
  textSecondary: t.foreground.secondary, // #1f2937
  textMuted: t.foreground.tertiary, // #4b5563
  placeholder: t.foreground.placeholder, // #9ca3af

  background: t.background.default, // #ffffff
  surface: t.surface.mainContainer, // #ffffff
  surfaceLow: t.surface.low, // #f8f9fb
  border: t.border.default, // #dcdfe4

  success: t.success.DEFAULT, // #3f8f65
  warning: t.warning.DEFAULT, // #a97428
  error: t.error.DEFAULT, // #c94736
  info: t.info.DEFAULT, // #5f88b2
} as const;

export const radii = { sm: 8, md: 10, lg: 14, pill: 999 } as const;

/**
 * Project-status accent colour, mapped onto the design tokens. Replaces the
 * ad-hoc hex map previously inlined in the projects list.
 */
export function projectStatusColor(status: string): string {
  const map: Record<string, string> = {
    planning: colors.textMuted,
    design: colors.primary,
    permit_review: colors.info,
    construction: colors.warning,
    handover: colors.success,
    complete: colors.success,
    on_hold: colors.error,
  };
  return map[status] ?? colors.textMuted;
}
