'use client';

import { AuthShell } from '@bimdossier/brand';
import type { JSX } from 'react';

import { AuthHeroBrand, AuthTopRight } from '@/features/auth/AuthHeroBrand';
import { LoginForm } from '@/features/auth/LoginForm';

export function LoginPanel(): JSX.Element {
  return (
    <AuthShell
      brand={<AuthHeroBrand />}
      topRight={<AuthTopRight />}
      form={<LoginForm />}
    />
  );
}
