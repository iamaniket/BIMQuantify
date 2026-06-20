/**
 * Undo/redo for the annotation document. The document IS the value
 * (`Annotation2D[]`), so history is just past/present/future stacks of arrays —
 * cheap and trivially correct. Pure functions are exported for unit testing; the
 * React hook wraps them.
 */

import { useCallback, useMemo, useReducer } from 'react';

import type { Annotation2D } from './types.js';

export interface History {
  past: Annotation2D[][];
  present: Annotation2D[];
  future: Annotation2D[][];
}

export function createHistory(present: Annotation2D[]): History {
  return { past: [], present, future: [] };
}

/** Commit a new present, pushing the old one onto the undo stack and clearing redo. */
export function pushHistory(h: History, present: Annotation2D[]): History {
  if (present === h.present) return h;
  return { past: [...h.past, h.present], present, future: [] };
}

export function undo(h: History): History {
  if (h.past.length === 0) return h;
  const previous = h.past[h.past.length - 1]!;
  return { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future] };
}

export function redo(h: History): History {
  if (h.future.length === 0) return h;
  const next = h.future[0]!;
  return { past: [...h.past, h.present], present: next, future: h.future.slice(1) };
}

type Action =
  | { kind: 'set'; present: Annotation2D[] }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'reset'; present: Annotation2D[] };

function reducer(h: History, action: Action): History {
  switch (action.kind) {
    case 'set':
      return pushHistory(h, action.present);
    case 'undo':
      return undo(h);
    case 'redo':
      return redo(h);
    case 'reset':
      return createHistory(action.present);
    default:
      return h;
  }
}

export interface AnnotationHistory {
  /** The current annotation document. */
  value: Annotation2D[];
  /** Commit a new value (array or updater). Pushes an undo entry. */
  set: (next: Annotation2D[] | ((prev: Annotation2D[]) => Annotation2D[])) => void;
  undo: () => void;
  redo: () => void;
  /** Replace the present and clear history (e.g. after a save). */
  reset: (next: Annotation2D[]) => void;
  canUndo: boolean;
  canRedo: boolean;
}

/** Stateful undo/redo over an `Annotation2D[]` document. */
export function useAnnotationHistory(initial: Annotation2D[]): AnnotationHistory {
  const [state, dispatch] = useReducer(reducer, initial, createHistory);

  const set = useCallback(
    (next: Annotation2D[] | ((prev: Annotation2D[]) => Annotation2D[])) => {
      dispatch({
        kind: 'set',
        present: typeof next === 'function' ? (next as (p: Annotation2D[]) => Annotation2D[])(state.present) : next,
      });
    },
    [state.present],
  );

  return useMemo<AnnotationHistory>(
    () => ({
      value: state.present,
      set,
      undo: () => { dispatch({ kind: 'undo' }); },
      redo: () => { dispatch({ kind: 'redo' }); },
      reset: (next: Annotation2D[]) => { dispatch({ kind: 'reset', present: next }); },
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
    }),
    [state, set],
  );
}
