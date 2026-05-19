'use client';

import { useRouter } from '@/i18n/navigation';
import { useEffect, type JSX } from 'react';

export default function AdminIndexPage(): JSX.Element {
  const router = useRouter();
  useEffect(() => {
    router.replace('/admin/organizations');
  }, [router]);
  return <main className="flex flex-1 items-center justify-center" />;
}
