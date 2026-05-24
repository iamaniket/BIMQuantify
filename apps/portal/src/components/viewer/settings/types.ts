export type ShortcutCategory = 'global' | 'navigation' | 'editing' | 'modifier';

export type NormalizedBinding = {
  command: string;
  label: string;
  combo: string;
  category: ShortcutCategory;
};

export type ViewerMode = '3d' | '2d';
