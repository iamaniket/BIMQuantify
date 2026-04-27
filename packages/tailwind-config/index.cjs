/**
 * Shared Tailwind preset for BIMstitch apps.
 * Consumers add their own `content` paths and inherit `darkMode` + `theme.extend` from here.
 */
/** @type {import('tailwindcss').Config} */
const preset = {
  content: [],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: 'var(--background)',
          secondary: 'var(--background-secondary)',
          tertiary: 'var(--background-tertiary)',
          hover: 'var(--background-hover)',
          active: 'var(--background-active)',
        },
        foreground: {
          DEFAULT: 'var(--foreground)',
          secondary: 'var(--foreground-secondary)',
          tertiary: 'var(--foreground-tertiary)',
          disabled: 'var(--foreground-disabled)',
          placeholder: 'var(--foreground-placeholder)',
          inverse: 'var(--foreground-inverse)',
        },
        border: {
          DEFAULT: 'var(--border)',
          hover: 'var(--border-hover)',
          focus: 'var(--border-focus)',
        },
        primary: {
          DEFAULT: 'var(--primary)',
          lighter: 'var(--primary-lighter)',
          light: 'var(--primary-light)',
          hover: 'var(--primary-hover)',
          active: 'var(--primary-active)',
          dark: 'var(--primary-dark)',
          foreground: 'var(--primary-foreground)',
        },
        success: {
          DEFAULT: 'var(--success)',
          lighter: 'var(--success-lighter)',
          light: 'var(--success-light)',
          hover: 'var(--success-hover)',
          foreground: 'var(--success-foreground)',
        },
        warning: {
          DEFAULT: 'var(--warning)',
          lighter: 'var(--warning-lighter)',
          light: 'var(--warning-light)',
          hover: 'var(--warning-hover)',
          foreground: 'var(--warning-foreground)',
        },
        error: {
          DEFAULT: 'var(--error)',
          lighter: 'var(--error-lighter)',
          light: 'var(--error-light)',
          hover: 'var(--error-hover)',
          foreground: 'var(--error-foreground)',
        },
        info: {
          DEFAULT: 'var(--info)',
          lighter: 'var(--info-lighter)',
          light: 'var(--info-light)',
          hover: 'var(--info-hover)',
          foreground: 'var(--info-foreground)',
        },
        surface: {
          page: 'var(--surface-page)',
          main: 'var(--surface-main)',
          low: 'var(--surface-low)',
          medium: 'var(--surface-medium)',
          high: 'var(--surface-high)',
          highest: 'var(--surface-highest)',
          inverse: 'var(--surface-inverse)',
        },
        ring: 'var(--ring)',
      },
      fontFamily: {
        sans: ['Geist', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        xs: '2px',
        sm: '4px',
        md: '6px',
        lg: '8px',
        xl: '12px',
      },
      spacing: {
        xxs: '2px',
        xxl: '24px',
        '4.5': '18px',
      },
      fontSize: {
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
        sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
        lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
        xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
      },
      transitionDuration: {
        fast: '150ms',
        normal: '200ms',
        slow: '300ms',
      },
    },
  },
  plugins: [],
};

module.exports = preset;
