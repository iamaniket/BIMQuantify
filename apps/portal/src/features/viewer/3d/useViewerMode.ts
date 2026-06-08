import { useEffect, useState } from 'react';

import type { ViewerHandle, ViewerMode } from '@bimstitch/viewer';

export interface ViewerModeState {
  mode: ViewerMode;
  toolName: string | null;
  toolLabel: string | null;
}

const NORMAL_STATE: ViewerModeState = { mode: 'normal', toolName: null, toolLabel: null };

export function useViewerMode(handle: ViewerHandle | null, ready?: boolean): ViewerModeState {
  const [state, setState] = useState<ViewerModeState>(NORMAL_STATE);

  useEffect(() => {
    if (!handle) return undefined;

    const offEnter = handle.events.on('mode:enter', ({ toolName, toolLabel }) => {
      setState({ mode: 'edit', toolName, toolLabel });
    });
    const offExit = handle.events.on('mode:exit', () => {
      setState(NORMAL_STATE);
    });

    return () => {
      offEnter();
      offExit();
    };
    // `ready` triggers re-subscription after viewer rebuild (events.clear)
  }, [handle, ready]);

  return state;
}
