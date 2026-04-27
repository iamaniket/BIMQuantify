// Vendored from E:/Proj/draftineai/copy/docs/figma/common/design-tokens.json
// Theme-agnostic primitives shared across all themes.

export const fontFamily = {
  sans: 'Geist, ui-sans-serif, system-ui, -apple-system, sans-serif',
  mono: 'Geist Mono, ui-monospace, SFMono-Regular, monospace',
} as const;

export const fontWeight = {
  thin: 100,
  ultraLight: 200,
  light: 300,
  regular: 400,
  medium: 500,
  semiBold: 600,
  bold: 700,
  black: 800,
  ultraBlack: 900,
} as const;

export const fontSize = {
  caption: '10px',
  label3: '12px',
  label2: '14px',
  label1: '16px',
  body3: '12px',
  body2: '14px',
  body1: '16px',
  title3: '18px',
  title2: '20px',
  title1: '24px',
  h6: '24px',
  h5: '28px',
  h4: '32px',
  h3: '40px',
  h2: '48px',
  h1: '56px',
} as const;

export const lineHeight = {
  caption: '12px',
  label3: '14px',
  label2: '16px',
  label1: '20px',
  body3: '16px',
  body2: '18px',
  body1: '20px',
  title3: '24px',
  title2: '24px',
  title1: '28px',
  h6: '28px',
  h5: '36px',
  h4: '40px',
  h3: '48px',
  h2: '60px',
  h1: '64px',
} as const;

export const spacing = {
  xxs: '2px',
  xs: '4px',
  sm: '6px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  xxl: '24px',
  '3xl': '32px',
  '4xl': '40px',
  '5xl': '48px',
} as const;

export const borderRadius = {
  none: '0',
  xs: '2px',
  sm: '4px',
  md: '6px',
  lg: '8px',
  xl: '12px',
  full: '9999px',
} as const;

export const breakpoints = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
} as const;

export const zIndex = {
  base: 0,
  dropdown: 10,
  sticky: 20,
  fixed: 30,
  modalBackdrop: 40,
  modal: 50,
  popover: 60,
  tooltip: 70,
} as const;

export const shadow = {
  sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
  xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
} as const;

export const transition = {
  fast: '150ms ease',
  normal: '200ms ease',
  slow: '300ms ease',
} as const;
