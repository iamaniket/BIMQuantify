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
  // Tracks the most recent URL we sent so a same-page anchor click followed
  // by a (no-op) router event — or vice versa — doesn't double-fire.
  const lastUrlRef = useRef<string | null>(null);

  function buildUrl(hash: string): string {
    const qs = searchParams.toString();
    const base = qs.length > 0 ? `${pathname}?${qs}` : pathname;
    return hash.length > 0 ? `${base}${hash}` : base;
  }

  function fire(url: string): void {
    if (lastUrlRef.current === url) return;
    lastUrlRef.current = url;
    capturePageview(url);
  }

  // Fires on full route change (pathname / query) AND on initial mount.
  // Includes any hash already in the URL (covers direct links like
  // /en#features pasted into the address bar).
  useEffect(() => {
    const hash = typeof window === 'undefined' ? '' : window.location.hash;
    fire(buildUrl(hash));
    // buildUrl/fire close over pathname/searchParams via this effect's scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  // Fires on same-page anchor clicks (#features, #pricing, #how-it-works).
  // Next.js doesn't re-render usePathname() for hash-only changes, so without
  // this listener those navigations are invisible to PostHog.
  useEffect(() => {
    function onHashChange(): void {
      fire(buildUrl(window.location.hash));
    }
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
