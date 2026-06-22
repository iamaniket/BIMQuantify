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
 * Brand gradients. `blue` is the design's `BLUE_GRAD`
 * (`linear-gradient(150deg, #3a63a6 0%, #2c5697 55%, #21437a 100%)`) used for the
 * Projects header, project cards, the drawer/docked sidebar, and the FAB. Rendered
 * with `react-native-svg` (see `components/BlueGradient.tsx`) — no native dep added.
 */
export const gradients = {
  blue: ['#3a63a6', '#2c5697', '#21437a'] as const,
} as const;

/**
 * The design's gold initials avatar (Avatar default in `projects-responsive.jsx`).
 * Used in the Projects header, project cards, and the drawer user row.
 */
export const avatar = { bg: '#e7c14e', fg: '#5a4410' } as const;

/**
 * Brand fonts. Only Fraunces (the display serif) is a real custom font —
 * loaded at runtime in `_layout.tsx` via `@expo-google-fonts/fraunces`. It is
 * reserved for the auth experience (wordmark, hero headline, "Welcome back.").
 * Body / labels / "mono" stay on the platform system font, matching the portal
 * (which aliases `--font-mono` to the system stack and only loads Fraunces).
 */
export const fonts = {
  display: 'Fraunces_500Medium', // headlines, "Welcome back.", wordmark
  displayItalic: 'Fraunces_500Medium_Italic', // headline accent words (models/issues/dossier)
  displaySemibold: 'Fraunces_600SemiBold', // KPI values, "BD" mark
  displayRegular: 'Fraunces_400Regular',
} as const;

/**
 * Brand-canvas constants used only by the login hero (the blue pane). Kept
 * separate from `colors` because they're gradient stops / accents specific to
 * the marketing surface, not part of the app-wide token set.
 */
export const brand = {
  // 168° linear gradient, stops at 0% / 60% / 100% (matches the web sign-in).
  gradient: ['#2c5697', '#20437a', '#1b3a6b'] as const,
  accentBlue: '#9bbce8', // italic headline accent words
  mint: '#7fe0a8', // WKB pill + "STATUS Normal" value
  surfacePage: colors.surfaceLow, // #f8f9fb — the light form-sheet surface
  heroFg: '#ffffff',
} as const;

/**
 * Project-phase accent colour, mapped onto the design tokens. Replaces the
 * ad-hoc hex map previously inlined in the projects list.
 */
export function projectPhaseColor(phase: string): string {
  const map: Record<string, string> = {
    design: colors.primary,
    tender: colors.info,
    work_prep: colors.textMuted,
    shell: colors.warning,
    finishing: colors.success,
    handover: colors.success,
  };
  return map[phase] ?? colors.textMuted;
}
