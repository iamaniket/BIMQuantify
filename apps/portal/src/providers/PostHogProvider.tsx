'use client';

import { jwtDecode } from 'jwt-decode';
import { usePathname, useSearchParams } from 'next/navigation';
import posthog from 'posthog-js';
import {
  Suspense,
  useEffect,
  useRef,
  type JSX,
  type ReactNode,
} from 'react';

import { env } from '@/lib/env';
import {
  capturePageview,
  groupOrganization,
  identifyUser,
  resetAnalytics,
  setAnalyticsEnabled,
} from '@/lib/analytics';
import { useAuth } from '@/providers/AuthProvider';

type AccessTokenPayload = {
  sub: string | undefined;
  org: string | undefined;
  // Super-admin impersonation marker. Present and non-empty when the access
  // token was minted via /auth/impersonate. We suppress analytics entirely
  // for these sessions so super-admin activity doesn't pollute product data.
  imp: string | undefined;
};

function isImpersonated(accessToken: string | undefined): boolean {
  if (accessToken === undefined) return false;
  try {
    const payload = jwtDecode<AccessTokenPayload>(accessToken);
    return typeof payload.imp === 'string' && payload.imp.length > 0;
  } catch {
    // Malformed token — fall back to "not impersonated" rather than crashing.
    // A bad access token will fail the auth dependency on its next request anyway.
    return false;
  }
}

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

type Props = {
  children: ReactNode;
};

export function PostHogProvider({ children }: Props): JSX.Element {
  const {
    tokens,
    me,
    activeMembership,
    hasHydrated,
  } = useAuth();
  // Tri-state: null = not yet decided, true = suppressed (impersonation /
  // no key), false = active. Keeps the init effect idempotent across the
  // many re-renders the auth context causes.
  const decisionRef = useRef<boolean | null>(null);
  const lastUserIdRef = useRef<string | null>(null);
  const lastOrgIdRef = useRef<string | null>(null);

  // One-shot init. Waits for hydration so we can read the access token and
  // detect impersonation before any event fires.
  useEffect(() => {
    if (!hasHydrated) return;
    if (decisionRef.current !== null) return;
    if (typeof window === 'undefined') return;

    if (env.NEXT_PUBLIC_POSTHOG_KEY === undefined || env.NEXT_PUBLIC_POSTHOG_KEY.length === 0) {
      decisionRef.current = true;
      return;
    }

    const accessToken = tokens === null ? undefined : tokens.access_token;
    if (isImpersonated(accessToken)) {
      decisionRef.current = true;
      return;
    }

    posthog.init(env.NEXT_PUBLIC_POSTHOG_KEY, {
      api_host: env.NEXT_PUBLIC_POSTHOG_HOST,
      ui_host: 'https://eu.posthog.com',
      person_profiles: 'identified_only',
      persistence: 'memory',
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: true,
      disable_session_recording: true,
    });
    setAnalyticsEnabled(true);
    decisionRef.current = false;
  }, [hasHydrated, tokens]);

  // Identify + group + reset. Runs on every auth state change but no-ops
  // when nothing material changed.
  useEffect(() => {
    if (decisionRef.current !== false) return;

    if (me === null) {
      if (lastUserIdRef.current !== null) {
        resetAnalytics();
        lastUserIdRef.current = null;
        lastOrgIdRef.current = null;
      }
      return;
    }

    const userChanged = lastUserIdRef.current !== me.user.id;
    const orgId = activeMembership === null ? null : activeMembership.organization_id;
    const orgChanged = lastOrgIdRef.current !== orgId;

    // Org switch on the same user: reset first so PostHog doesn't merge the
    // two orgs' event streams under the previous group context.
    if (!userChanged && orgChanged && lastOrgIdRef.current !== null) {
      resetAnalytics();
    }

    if (userChanged || orgChanged) {
      identifyUser(me.user.id, {
        email: me.user.email,
        name: me.user.full_name ?? undefined,
        is_superuser: me.user.is_superuser,
      });
      lastUserIdRef.current = me.user.id;
    }

    if (orgChanged && activeMembership !== null) {
      groupOrganization(activeMembership.organization_id, {
        name: activeMembership.organization_name,
        seat_limit: activeMembership.seat_limit,
        seat_count_used: activeMembership.seat_count_used,
      });
    }
    lastOrgIdRef.current = orgId;
  }, [me, activeMembership]);

  return (
    <>
      <Suspense fallback={null}>
        <PageviewCapture />
      </Suspense>
      {children}
    </>
  );
}
