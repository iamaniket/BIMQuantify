'use client';

import { IconContext } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { DEFAULT_ICON_WEIGHT } from './lib/icons.js';

type Props = { children: ReactNode };

/**
 * Sets the default Phosphor icon weight for the entire subtree.
 * Wrap the app root so every `<Icon>` and every direct icon component
 * renders as fill without an explicit `weight` prop.
 */
export function IconProvider({ children }: Props) {
  return (
    <IconContext.Provider value={{ weight: DEFAULT_ICON_WEIGHT }}>
      {children}
    </IconContext.Provider>
  );
}
