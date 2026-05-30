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
  'inspect.',
  'snapping.',
  'rotateRight', 'rotateLeft',
  'hover.',
  'xray.',
  'wireframe.',
  'section.',
  'measurement.',
  'eraser.',
];

const GLOBAL_PREFIXES = [
  'mode.',
  'navigate.',
  'screenshot.',
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
  swatch: string;
  tint: string;
};

export const CATEGORY_STYLES: Record<ShortcutCategory, CategoryStyle> = {
  global: {
    bg: 'bg-warning-lighter',
    border: 'border-warning',
    text: 'text-warning',
    swatch: 'var(--warning)',
    tint: 'var(--warning-light)',
  },
  navigation: {
    bg: 'bg-primary-lighter',
    border: 'border-primary',
    text: 'text-primary',
    swatch: 'var(--primary)',
    tint: 'var(--primary-light)',
  },
  editing: {
    bg: 'bg-success-lighter',
    border: 'border-success',
    text: 'text-success',
    swatch: 'var(--success)',
    tint: 'var(--success-light)',
  },
  modifier: {
    bg: 'bg-info-lighter',
    border: 'border-info',
    text: 'text-info',
    swatch: 'var(--info)',
    tint: 'var(--info-light)',
  },
};

export const UNBOUND_STYLE: CategoryStyle = {
  bg: 'bg-surface-high',
  border: 'border-border',
  text: 'text-foreground-tertiary',
  swatch: 'var(--border)',
  tint: 'var(--surface-high)',
};

// i18n key suffixes under `viewer.shortcuts.*`; resolve at React render sites.
export const CATEGORY_LABEL_KEYS: Record<ShortcutCategory, string> = {
  global: 'categoryGlobal',
  navigation: 'categoryNavigation',
  editing: 'categoryEditing',
  modifier: 'categoryModifier',
};
