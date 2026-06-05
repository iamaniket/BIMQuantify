/**
 * Format a keyboard shortcut combo string for display.
 *
 * Replaces arrow-key names with their Unicode symbols and returns an em-dash
 * when the combo is empty. Shared by the settings shortcut list, the
 * key-bindings tab, and the context menu.
 */
export function prettyKey(combo: string): string {
  if (!combo) return '—';
  return combo
    .replace('ArrowUp', '↑').replace('ArrowDown', '↓')
    .replace('ArrowLeft', '←').replace('ArrowRight', '→');
}
