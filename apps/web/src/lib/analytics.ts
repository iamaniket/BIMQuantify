'use client';

import posthog from 'posthog-js';

// Flipped to `true` by PostHogProvider once posthog.init has run. All helpers
// in this module short-circuit when false so call sites can fire events
// unconditionally without producing "PostHog not initialized" warnings.
let enabled = false;

export function setAnalyticsEnabled(value: boolean): void {
  enabled = value;
}

export function captureEvent(event: string, properties?: Record<string, unknown>): void {
  if (!enabled) return;
  posthog.capture(event, properties);
}

export function capturePageview(url: string): void {
  if (!enabled) return;
  posthog.capture('$pageview', { $current_url: url });
}
