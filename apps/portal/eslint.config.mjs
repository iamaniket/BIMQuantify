import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { nextAppConfig } from '@bimdossier/eslint-config';

const tsconfigRootDir = path.dirname(fileURLToPath(import.meta.url));

export default nextAppConfig({
  tsconfigRootDir,
  projects: ['./tsconfig.json', './tests/tsconfig.json'],
  forbidElements: true,
  extraIgnores: [
    'playwright-report/**',
    'test-results/**',
    'playwright.config.ts',
    'tailwind.config.ts',
    'scripts/**',
    'public/**',
  ],
  i18nAllowFiles: [
    // Skeuomorphic art: raw brand label baked into a fake keyboard / mouse diagram.
    'src/components/shared/viewer/shared/settings/VisualKeyboard.tsx',
    'src/components/shared/viewer/shared/settings/MouseDiagram.tsx',
    // Catastrophic fallback — replaces the root layout, can't reach the i18n provider.
    'src/app/**/global-error.tsx',
  ],
});
