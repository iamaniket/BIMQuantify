import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadEnvFile(filePath: string): void {
  try {
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // File not found — that's fine
  }
}

// Load API .env first, then local override wins
// __dirname = apps/portal/tests/support
// '../../../api/.env' → apps/api/.env
// '../../.env.test.local' → apps/portal/.env.test.local
loadEnvFile(resolve(__dirname, '../../../api/.env'));
loadEnvFile(resolve(__dirname, '../../.env.test.local'));

export const E2E_ENV = {
  SUPERADMIN_EMAIL: process.env['SEED_SUPERADMIN_EMAIL'] ?? '',
  SUPERADMIN_PASSWORD: process.env['SEED_SUPERADMIN_PASSWORD'] ?? '',
  API_URL: process.env['E2E_API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:8000',
  MAILHOG_URL: process.env['E2E_MAILHOG_URL'] ?? process.env['MAILHOG_URL'] ?? 'http://localhost:8025',
};

export function requireSuperAdminCreds(): { email: string; password: string } {
  const { SUPERADMIN_EMAIL: email, SUPERADMIN_PASSWORD: password } = E2E_ENV;
  if (!email || !password) {
    throw new Error(
      'Missing SEED_SUPERADMIN_EMAIL / SEED_SUPERADMIN_PASSWORD. '
      + 'Set them in apps/api/.env or apps/portal/.env.test.local',
    );
  }
  return { email, password };
}
