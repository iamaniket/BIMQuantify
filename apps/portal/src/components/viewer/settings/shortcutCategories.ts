import type { ShortcutCategory } from './types';

const NAVIGATION_PREFIXES = [
  'camera.',
  'zoomIn', 'zoomOut',
  'fitPage', 'fitWidth', 'actualSize',
  'nextPage', 'prevPage', 'firstPage', 'lastPage',
];

const EDITING_PREFIXES = [
  'selection.',
  'visibility.',
  'isolation.',
  'snapping.',
  'rotateRight', 'rotateLeft',
  'hover.',
  'xray.',
  'wireframe.',
  'section.',
  'measurement.',
];

const GLOBAL_PREFIXES = [
  'mode.',
  'toolSelect', 'toolPan', 'toolZoom',
  'shortcuts.', 'mouseBindings.',
];

export function classifyCommand(command: string): ShortcutCategory {
  for (const p of GLOBAL_PREFIXES) {
    if (command === p || command.startsWith(p)) return 'global';
  }
  for (const p of NAVIGATION_PREFIXES) {
    if (command === p || command.startsWith(p)) return 'navigation';
  }
  for (const p of EDITING_PREFIXES) {
    if (command === p || command.startsWith(p)) return 'editing';
  }
  return 'global';
}

export type CategoryStyle = {
  bg: string;
  border: string;
  text: string;
};

export const CATEGORY_STYLES: Record<ShortcutCategory, CategoryStyle> = {
  global: {
    bg: 'bg-warning-lighter',
    border: 'border-warning',
    text: 'text-warning',
  },
  navigation: {
    bg: 'bg-primary-lighter',
    border: 'border-primary',
    text: 'text-primary',
  },
  editing: {
    bg: 'bg-success-lighter',
    border: 'border-success',
    text: 'text-success',
  },
  modifier: {
    bg: 'bg-info-lighter',
    border: 'border-info',
    text: 'text-info',
  },
};

export const UNBOUND_STYLE: CategoryStyle = {
  bg: 'bg-surface-high',
  border: 'border-border',
  text: 'text-foreground-tertiary',
};

export const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  global: 'Global',
  navigation: 'Navigation',
  editing: 'Editing',
  modifier: 'Modifier',
};
