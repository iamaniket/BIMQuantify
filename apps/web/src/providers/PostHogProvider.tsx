'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import posthog from 'posthog-js';
import {
  Suspense,
  useEffect,
  useRef,
  type JSX,
  type ReactNode,
} from 'react';

import { capturePageview, setAnalyticsEnabled } from '@/lib/analytics';
import { env } from '@/lib/env';

function PageviewCapture(): null {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const qs = searchParams.toString();
    const url = qs.length > 0 ? `${pathname}?${qs}` : pathname;
    capturePageview(url);
  }, [pathname, searchParams]);

  return null;
}

type Props = { children: ReactNode };

export function PostHogProvider({ children }: Props): JSX.Element {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    if (typeof window === 'undefined') return;
    if (env.NEXT_PUBLIC_POSTHOG_KEY === undefined || env.NEXT_PUBLIC_POSTHOG_KEY.length === 0) {
      return;
    }

    posthog.init(env.NEXT_PUBLIC_POSTHOG_KEY, {
      api_host: env.NEXT_PUBLIC_POSTHOG_HOST,
      ui_host: 'https://eu.posthog.com',
      // Marketing site is anonymous; persons are created on every visit so
      // funnel data (landing -> request-access) works without identify().
      person_profiles: 'always',
      // No cookies / localStorage means no consent banner needed for B2B
      // marketing. Trade-off: a returning visitor reads as a fresh person
      // until they click through to the portal and authenticate.
      persistence: 'memory',
      autocapture: true,
      capture_pageview: false,
      capture_pageleave: true,
      disable_session_recording: true,
    });
    setAnalyticsEnabled(true);
    initialized.current = true;
  }, []);

  return (
    <>
      <Suspense fallback={null}>
        <PageviewCapture />
      </Suspense>
      {children}
    </>
  );
}
