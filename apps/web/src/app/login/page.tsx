import type { JSX } from 'react';

import { LoginForm } from '@/features/auth/LoginForm';

export default function LoginPage(): JSX.Element {
  return (
    <main className="flex flex-col items-center justify-center min-h-screen gap-6 p-8">
      <h1 className="text-3xl font-semibold">Sign in</h1>
      <LoginForm />
    </main>
  );
}
