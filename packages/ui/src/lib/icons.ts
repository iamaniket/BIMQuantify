/**
 * Shared icon types and weight constants.
 *
 * `AppIcon` is the canonical type for an icon component prop.
 * Weight constants centralise the fill/bold decision so every
 * consumer renders the same style.
 */

import type { Icon as PhosphorIcon, IconWeight } from '@phosphor-icons/react';

/** Canonical icon-component type — use this for `icon` props. */
export type AppIcon = PhosphorIcon;

/** Default weight for all icons across the app (solid fill). */
export const DEFAULT_ICON_WEIGHT: IconWeight = 'fill';
