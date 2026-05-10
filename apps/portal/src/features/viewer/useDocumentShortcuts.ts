'use client';

import { useEffect, type RefObject } from 'react';

import {
  comboFromKeyboardEvent,
  type DocumentAction,
  type DocumentShortcutMap,
} from '@/lib/documentSettings';

export type DocumentShortcutHandlers = Partial<Record<DocumentAction, () => void>>;

type Options = {
  /** Container the listener attaches to. We listen on `window` so the user
   *  can use shortcuts whether or not the canvas has focus, but we only
   *  fire when the active element isn't a typing surface. */
  enabled: boolean;
  shortcuts: DocumentShortcutMap;
  handlers: DocumentShortcutHandlers;
  /** Optional ref. If provided, we only respond when the event target is
   *  inside it OR when the user isn't focused on a typing surface. */
  scopeRef?: RefObject<HTMLElement | null>;
};

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function useDocumentShortcuts({
  enabled,
  shortcuts,
  handlers,
  scopeRef,
}: Options): void {
  useEffect(() => {
    if (!enabled) return undefined;

    // Build combo -> action lookup once per change.
    const comboToAction = new Map<string, DocumentAction>();
    for (const [action, combo] of Object.entries(shortcuts)) {
      if (!combo) continue;
      comboToAction.set(combo, action as DocumentAction);
    }

    const onKey = (ev: KeyboardEvent): void => {
      if (isTypingTarget(ev.target)) return;
      // If a scope is set, also accept events that target body/window when
      // the scope is currently in the DOM (the PDF viewer is always shown
      // when this hook is enabled, so we don't need to gate further).
      void scopeRef;

      const combo = comboFromKeyboardEvent(ev);
      if (!combo) return;
      const action = comboToAction.get(combo);
      if (!action) return;
      const handler = handlers[action];
      if (!handler) return;
      ev.preventDefault();
      handler();
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [enabled, shortcuts, handlers, scopeRef]);
}
