export type ThemeTokens = {
  name: 'light' | 'dark';
  background: {
    default: string;
    secondary: string;
    tertiary: string;
    hover: string;
    active: string;
  };
  foreground: {
    default: string;
    secondary: string;
    tertiary: string;
    disabled: string;
    placeholder: string;
    inverse: string;
  };
  border: {
    default: string;
    hover: string;
    focus: string;
  };
  primary: {
    lighter: string;
    light: string;
    DEFAULT: string;
    hover: string;
    active: string;
    dark: string;
    foreground: string;
  };
  success: {
    lighter: string;
    light: string;
    DEFAULT: string;
    hover: string;
    foreground: string;
  };
  warning: {
    lighter: string;
    light: string;
    DEFAULT: string;
    hover: string;
    foreground: string;
  };
  error: {
    lighter: string;
    light: string;
    DEFAULT: string;
    hover: string;
    foreground: string;
  };
  info: {
    lighter: string;
    light: string;
    DEFAULT: string;
    hover: string;
    foreground: string;
  };
  surface: {
    page: string;
    mainContainer: string;
    low: string;
    medium: string;
    high: string;
    highest: string;
    inverse: string;
  };
  ring: string;
};
