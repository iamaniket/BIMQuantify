import type { Config } from 'tailwindcss';

import preset from '@bimstitch/tailwind-config';

const config: Config = {
  presets: [preset],
  content: [
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
};

export default config;
