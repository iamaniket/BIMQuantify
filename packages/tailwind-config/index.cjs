/**
 * Shared Tailwind preset for BimDossier apps.
 * Consumers add their own `content` paths and inherit `darkMode` + `theme.extend` from here.
 */
/** @type {import('tailwindcss').Config} */
const preset = {
  content: [],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Core tokens use the `rgb(var(--x-rgb) / <alpha-value>)` channel form so
        // Tailwind's /opacity modifiers (bg-primary/5, ring-primary/30, …) compile.
        // The `-rgb` companions are emitted next to the hex tokens by
        // @bimdossier/design-tokens (scripts/build-css.mjs). The hex `--x` vars are
        // retained for direct `var(--x)` usage in inline styles / charts / SVG.
        background: {
          DEFAULT: 'rgb(var(--background-rgb) / <alpha-value>)',
          secondary: 'rgb(var(--background-secondary-rgb) / <alpha-value>)',
          tertiary: 'rgb(var(--background-tertiary-rgb) / <alpha-value>)',
          hover: 'rgb(var(--background-hover-rgb) / <alpha-value>)',
          active: 'rgb(var(--background-active-rgb) / <alpha-value>)',
        },
        foreground: {
          DEFAULT: 'rgb(var(--foreground-rgb) / <alpha-value>)',
          secondary: 'rgb(var(--foreground-secondary-rgb) / <alpha-value>)',
          tertiary: 'rgb(var(--foreground-tertiary-rgb) / <alpha-value>)',
          disabled: 'rgb(var(--foreground-disabled-rgb) / <alpha-value>)',
          placeholder: 'rgb(var(--foreground-placeholder-rgb) / <alpha-value>)',
          inverse: 'rgb(var(--foreground-inverse-rgb) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--border-rgb) / <alpha-value>)',
          hover: 'rgb(var(--border-hover-rgb) / <alpha-value>)',
          focus: 'rgb(var(--border-focus-rgb) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'rgb(var(--primary-rgb) / <alpha-value>)',
          lighter: 'rgb(var(--primary-lighter-rgb) / <alpha-value>)',
          light: 'rgb(var(--primary-light-rgb) / <alpha-value>)',
          hover: 'rgb(var(--primary-hover-rgb) / <alpha-value>)',
          active: 'rgb(var(--primary-active-rgb) / <alpha-value>)',
          dark: 'rgb(var(--primary-dark-rgb) / <alpha-value>)',
          foreground: 'rgb(var(--primary-foreground-rgb) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'rgb(var(--success-rgb) / <alpha-value>)',
          lighter: 'rgb(var(--success-lighter-rgb) / <alpha-value>)',
          light: 'rgb(var(--success-light-rgb) / <alpha-value>)',
          hover: 'rgb(var(--success-hover-rgb) / <alpha-value>)',
          foreground: 'rgb(var(--success-foreground-rgb) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'rgb(var(--warning-rgb) / <alpha-value>)',
          lighter: 'rgb(var(--warning-lighter-rgb) / <alpha-value>)',
          light: 'rgb(var(--warning-light-rgb) / <alpha-value>)',
          hover: 'rgb(var(--warning-hover-rgb) / <alpha-value>)',
          foreground: 'rgb(var(--warning-foreground-rgb) / <alpha-value>)',
        },
        error: {
          DEFAULT: 'rgb(var(--error-rgb) / <alpha-value>)',
          lighter: 'rgb(var(--error-lighter-rgb) / <alpha-value>)',
          light: 'rgb(var(--error-light-rgb) / <alpha-value>)',
          hover: 'rgb(var(--error-hover-rgb) / <alpha-value>)',
          foreground: 'rgb(var(--error-foreground-rgb) / <alpha-value>)',
        },
        info: {
          DEFAULT: 'rgb(var(--info-rgb) / <alpha-value>)',
          lighter: 'rgb(var(--info-lighter-rgb) / <alpha-value>)',
          light: 'rgb(var(--info-light-rgb) / <alpha-value>)',
          hover: 'rgb(var(--info-hover-rgb) / <alpha-value>)',
          foreground: 'rgb(var(--info-foreground-rgb) / <alpha-value>)',
        },
        surface: {
          page: 'rgb(var(--surface-page-rgb) / <alpha-value>)',
          main: 'rgb(var(--surface-main-rgb) / <alpha-value>)',
          low: 'rgb(var(--surface-low-rgb) / <alpha-value>)',
          medium: 'rgb(var(--surface-medium-rgb) / <alpha-value>)',
          high: 'rgb(var(--surface-high-rgb) / <alpha-value>)',
          highest: 'rgb(var(--surface-highest-rgb) / <alpha-value>)',
          inverse: 'rgb(var(--surface-inverse-rgb) / <alpha-value>)',
        },
        ring: 'rgb(var(--ring-rgb) / <alpha-value>)',
        // Sidebar tokens are app-level (apps/portal/src/app/globals.css), several
        // are already rgba(), and none are used with /opacity — kept as bare var().
        sidebar: {
          accent: 'var(--sidebar-accent)',
          'accent-strong': 'var(--sidebar-accent-strong)',
          surface: 'var(--sidebar-surface)',
          fg: 'var(--sidebar-fg)',
          'fg-subtle': 'var(--sidebar-fg-subtle)',
          'fg-muted': 'var(--sidebar-fg-muted)',
          border: 'var(--sidebar-border)',
          raised: 'var(--sidebar-raised)',
          hover: 'var(--sidebar-hover)',
          active: 'var(--sidebar-active)',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        // `mono` is aliased to the system sans stack: the app uses one text
        // family everywhere. This alias guarantees any remaining `font-mono`
        // class renders the same system sans-serif.
        mono: ['ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        // Brand display face for hero copy on auth/marketing pages.
        // Falls back to a serif so the page still looks correct if the
        // webfont hasn't loaded.
        display: ['var(--font-display)', 'Fraunces', 'Georgia', '"Times New Roman"', 'serif'],
      },
      borderRadius: {
        // `xs` (no Tailwind default) and `sm` (4px, overrides Tailwind's 2px)
        // are the only radii that diverge from the framework — md/lg/xl/2xl
        // matched Tailwind v3 exactly and were dropped as no-op redeclarations.
        xs: '2px',
        sm: '4px',
      },
      maxWidth: {
        // Wider page-frame step above Tailwind's default 7xl (80rem). The
        // marketing page frame uses `max-w-8xl` so the centered content fills
        // more of large monitors (less empty side margin).
        '8xl': '88rem', // 1408px
      },
      fontSize: {
        micro: ['9px', { lineHeight: '11px', letterSpacing: '0' }],
        caption: ['10px', { lineHeight: '12px', letterSpacing: '-0.01em' }],
        body3: ['12px', { lineHeight: '16px', letterSpacing: '-0.01em' }],
        body2: ['14px', { lineHeight: '18px', letterSpacing: '-0.01em' }],
        body1: ['16px', { lineHeight: '20px', letterSpacing: '-0.01em' }],
        title3: ['18px', { lineHeight: '24px', letterSpacing: '-0.01em' }],
        title2: ['20px', { lineHeight: '24px', letterSpacing: '-0.01em' }],
        title1: ['24px', { lineHeight: '28px', letterSpacing: '-0.01em' }],
        h6: ['24px', { lineHeight: '28px', letterSpacing: '-0.01em' }],
        h5: ['28px', { lineHeight: '36px', letterSpacing: '-0.01em' }],
        h4: ['32px', { lineHeight: '40px', letterSpacing: '-0.01em' }],
        h3: ['40px', { lineHeight: '48px', letterSpacing: '-0.01em' }],
        h2: ['48px', { lineHeight: '60px', letterSpacing: '-0.01em' }],
        h1: ['56px', { lineHeight: '64px', letterSpacing: '-0.01em' }],
      },
      boxShadow: {
        // sm/md/lg/xl are intentionally omitted: they matched Tailwind v3's own
        // black-rgba defaults exactly, so they're inherited rather than redeclared.
        // Only the custom control/card elevations are defined here.
        // Raised solid controls (primary/destructive buttons): subtle drop +
        // inner top highlight for the "lifted key" look. -hover lifts more,
        // -active presses the control in.
        control: '0 1px 2px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
        'control-hover': '0 2px 4px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
        'control-active': 'inset 0 1px 3px rgba(0, 0, 0, 0.15)',
        // Kanban card resting / lifted-on-hover.
        card: '0 2px 8px rgba(0, 0, 0, 0.08)',
        'card-hover': '0 6px 20px rgba(0, 0, 0, 0.12)',
        // 112x160 hero thumbnail elevation. Theme-aware via the CSS var
        // (--shadow-hero-thumbnail in apps/portal globals.css): blue-tinted in
        // light, black in dark. Named (not shadow-[var(...)]) so Tailwind treats
        // it as a full box-shadow rather than a shadow color.
        'hero-thumbnail': 'var(--shadow-hero-thumbnail)',
      },
      transitionDuration: {
        fast: '150ms',
        normal: '200ms',
      },
      keyframes: {
        'viewer-fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'brick-appear': {
          '0%': { opacity: '0' },
          '8%': { opacity: '1' },
          '82%': { opacity: '1' },
          '92%': { opacity: '0' },
          '100%': { opacity: '0' },
        },
        'roof-appear': {
          '0%, 58%': { opacity: '0' },
          '68%': { opacity: '1' },
          '82%': { opacity: '1' },
          '92%': { opacity: '0' },
          '100%': { opacity: '0' },
        },
        'window-appear': {
          '0%, 28%': { opacity: '0' },
          '36%': { opacity: '1' },
          '82%': { opacity: '1' },
          '92%': { opacity: '0' },
          '100%': { opacity: '0' },
        },
        'smoke-puff': {
          '0%': { opacity: '0' },
          '20%': { opacity: '0.3' },
          '60%': { opacity: '0.15' },
          '100%': { opacity: '0' },
        },
        'detail-appear': {
          '0%, 52%': { opacity: '0' },
          '62%': { opacity: '0.6' },
          '82%': { opacity: '0.6' },
          '92%': { opacity: '0' },
          '100%': { opacity: '0' },
        },
      },
      animation: {
        'viewer-fade-in': 'viewer-fade-in 250ms ease-out',
        'brick-appear': 'brick-appear 7s ease-in-out infinite',
        'roof-appear': 'roof-appear 7s ease-in-out infinite',
        'window-appear': 'window-appear 7s ease-in-out infinite',
        'smoke-puff': 'smoke-puff 3s ease-in-out infinite',
        'detail-appear': 'detail-appear 7s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

module.exports = preset;
