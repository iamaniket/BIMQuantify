import type { JSX } from 'react';

import { LoginForm } from '@/features/auth/LoginForm';

export default function LoginPage(): JSX.Element {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-lg border border-border bg-surface-main p-8 shadow-md">
        <div className="flex flex-col gap-1">
          <h1 className="text-h5 font-semibold text-foreground">Sign in</h1>
          <p className="text-body2 text-foreground-tertiary">
            Welcome back. Enter your credentials to continue.
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
