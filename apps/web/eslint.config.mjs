import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { nextAppConfig } from '@bimdossier/eslint-config';

const tsconfigRootDir = path.dirname(fileURLToPath(import.meta.url));

export default nextAppConfig({
  tsconfigRootDir,
  projects: ['./tsconfig.json', './tests/tsconfig.json'],
  extraIgnores: ['playwright-report/**', 'test-results/**', 'playwright.config.ts'],
});
