'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent, type JSX } from 'react';

import { useRouter } from '@/i18n/navigation';
import { apiClient } from '@/lib/api/client';
import { z } from 'zod';

/**
 * Activation page for admin-invited users.
 *
 * Two-step under the hood:
 *   1. POST /auth/verify  { token }  → flips users.is_verified=true
 *   2. POST /auth/reset-password { token, password } → sets password
 *
 * The verify token from the invite email is reused for both steps because
 * FastAPI Users issues both with the same JWT secret + audience. If step 1
 * fails because the token was already consumed (e.g. user clicked twice),
 * step 2 still proceeds — the password set is the user-meaningful action
 * and we don't want a duplicate click to be a footgun.
 *
 * On success the page routes to /login so the user can sign in immediately.
 */
const VerifyResponseSchema = z.object({}).passthrough();

export default function ActivatePage(): JSX.Element {
  const t = useTranslations('activate');
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (token === null || token === '') {
    return (
      <main className="mx-auto mt-24 max-w-md p-6">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="mt-4 text-red-600">{t('errors.tokenMissing')}</p>
      </main>
    );
  }

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t('errors.passwordMismatch'));
      return;
    }
    setPending(true);
    try {
      // Step 1 — verify (idempotent best-effort; ignore failure)
      try {
        await apiClient.post('/auth/verify', { token }, VerifyResponseSchema, '');
      } catch {
        // already verified or token re-use — fall through to password reset.
      }
      // Step 2 — set password via reset-password
      await apiClient.post(
        '/auth/reset-password',
        { token, password },
        VerifyResponseSchema,
        '',
      );
      router.replace('/login?activated=1');
    } catch {
      setError(t('errors.activationFailed'));
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="mx-auto mt-24 max-w-md p-6">
      <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>
      <p className="mt-2 text-sm text-slate-600">{t('subtitle')}</p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700">
            {t('field.password')}
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="confirm" className="block text-sm font-medium text-slate-700">
            {t('field.passwordConfirm')}
          </label>
          <input
            id="confirm"
            type="password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        {error !== null && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex w-full justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
        >
          {t('cta')}
        </button>
      </form>
    </main>
  );
}
