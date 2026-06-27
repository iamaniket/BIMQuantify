import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// The design system (packages/tailwind-config) defines a custom font-size scale.
// tailwind-merge only knows its built-in sizes, so it misclassifies e.g.
// `text-body2` as a text-COLOR and silently drops real colors like
// `text-primary-foreground` merged before it (this is why primary buttons lost
// their text colour). Registering the custom sizes keeps cn() conflict
// resolution correct everywhere it's used.
//
// THIS LIST MUST CONTAIN EVERY `fontSize` key in packages/tailwind-config/index.cjs
// (the single source of the scale). scripts/check-fontsize-sync.mjs runs in
// `pnpm lint` and fails CI if the two drift in either direction.
export const CUSTOM_TEXT_SIZES = [
  'micro', 'caption', 'body3', 'body2', 'body1', 'label2',
  'title3', 'title2', 'title1',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...CUSTOM_TEXT_SIZES] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
