/**
 * Single source of truth for finding-marker styling, shared by the 3D
 * (`entity-marker`, CSS2D DOM) and 2D (`entity-marker-2d`, three.js geometry)
 * plugins so a finding reads identically in 3D, 2D, and split mode.
 *
 * Colors are hex strings so both consumers work unchanged: the 3D plugin drops
 * them straight into CSS, the 2D plugin feeds them to `new THREE.Color(hex)`.
 *
 * Visual contract:
 *  - **Fill** = the finding's lifecycle status color (draft=gray, open=info,
 *    in_progress=primary, resolved/verified=success). Mirrors the portal kanban
 *    palette (dark-theme semantic tokens).
 *  - **Ring** = red while the finding is *open* (draft / open / in_progress, or
 *    an unknown/missing status) to signal "this is a finding / open issue"; a
 *    neutral light ring once it is resolved/verified so a closed finding stops
 *    looking alarming.
 */

export const FINDING_STATUS_COLORS = {
  draft: '#c1c6cc',
  open: '#5f88b2',
  in_progress: '#3a5f99',
  resolved: '#4baf7d',
  verified: '#4baf7d',
} as const;

/** Fill used when a finding has no/unknown status. */
export const FINDING_FILL_FALLBACK = '#ef4444';

/** Ring color for an open finding (draft/open/in_progress, or unknown). */
export const RING_OPEN = '#ef4444';
/** Ring color for a closed finding (resolved/verified) — neutral hairline. */
export const RING_CLOSED = '#ffffff';

// A finding is "closed" only in an explicitly terminal state — anything else,
// including draft/open/in_progress and an unknown/missing status, is treated as
// open (red ring), symmetric with the red fill fallback.
const CLOSED_STATES = new Set(['resolved', 'verified']);

/** Inner-disc color: the finding's status color, or the red fallback. */
export function findingFillColor(status?: string): string {
  return (status && FINDING_STATUS_COLORS[status as keyof typeof FINDING_STATUS_COLORS]) ?? FINDING_FILL_FALLBACK;
}

/** Ring color: neutral once closed (resolved/verified), red otherwise. */
export function findingRingColor(status?: string): string {
  return status && CLOSED_STATES.has(status) ? RING_CLOSED : RING_OPEN;
}

/** On-screen marker diameter (px) — kept equal in 2D and 3D. */
export const MARKER_DIAMETER_PX = 14;
/** Ring thickness (px). */
export const MARKER_RING_PX = 2.5;
