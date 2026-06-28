import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { nextAppConfig } from '@bimdossier/eslint-config';

const tsconfigRootDir = path.dirname(fileURLToPath(import.meta.url));

export default nextAppConfig({
  tsconfigRootDir,
  // Consistent with portal: ban raw <select>/<textarea> in favour of @bimdossier/ui.
  forbidElements: true,
  // web has no type-checked test sources; its tests/tsconfig.json has an empty
  // include (TS18003), so it's intentionally not in the project list.
  projects: ['./tsconfig.json'],
  extraIgnores: [
    'playwright-report/**',
    'test-results/**',
    'playwright.config.ts',
    'tailwind.config.ts',
    'scripts/**',
    'public/**',
  ],
});
