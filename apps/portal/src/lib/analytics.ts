'use client';

import posthog from 'posthog-js';

export const PORTAL_EVENTS = {
  SIGNED_IN: 'portal.signed_in',
  ORGANIZATION_SWITCHED: 'portal.organization_switched',
  PROJECT_CREATED: 'portal.project_created',
  PROJECT_OPENED: 'portal.project_opened',
  VIEWER_OPENED: 'portal.viewer_opened',
  FILE_UPLOADED: 'portal.file_uploaded',
  COMPLIANCE_CHECK_RUN: 'portal.compliance_check_run',
  REPORT_GENERATED: 'portal.report_generated',
} as const;

export type PortalEvent = typeof PORTAL_EVENTS[keyof typeof PORTAL_EVENTS];

// Flipped to `true` by PostHogProvider once posthog.init has run and the
// session isn't suppressed (impersonation, missing key). All calls in this
// module short-circuit when false so feature code can call `track(...)`
// unconditionally with no warnings in the console.
let enabled = false;

export function setAnalyticsEnabled(value: boolean): void {
  enabled = value;
}

export function track(event: PortalEvent, properties?: Record<string, unknown>): void {
  if (!enabled) return;
  posthog.capture(event, properties);
}

export function identifyUser(
  userId: string,
  properties?: Record<string, unknown>,
): void {
  if (!enabled) return;
  posthog.identify(userId, properties);
}

export function groupOrganization(
  organizationId: string,
  properties?: Record<string, unknown>,
): void {
  if (!enabled) return;
  posthog.group('organization', organizationId, properties);
}

export function resetAnalytics(): void {
  if (!enabled) return;
  posthog.reset();
}

export function capturePageview(url: string): void {
  if (!enabled) return;
  posthog.capture('$pageview', { $current_url: url });
}
