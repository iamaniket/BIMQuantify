/**
 * Tiny dependency-free SVG icons for the annotation toolbar. Kept inside the
 * package (rather than importing `@bimdossier/ui`) so `@bimdossier/annotation`
 * stays standalone — loadable in the portal, the viewer-embed WebView, and any
 * future host without dragging in the UI kit's peer dependencies.
 *
 * Icons use `currentColor`, so the toolbar controls their colour via text-colour
 * Tailwind classes.
 */

import type { JSX, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps): IconProps {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    ...props,
  };
}

export function CursorIcon(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M5 4l6 16 2.5-6.5L20 11z" />
    </svg>
  );
}

export function RectangleIcon(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <rect x="4" y="6" width="16" height="12" rx="1" />
    </svg>
  );
}

export function EllipseIcon(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <ellipse cx="12" cy="12" rx="8" ry="6" />
    </svg>
  );
}

export function LineIcon(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <line x1="5" y1="19" x2="19" y2="5" />
    </svg>
  );
}

export function ArrowIcon(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <line x1="5" y1="19" x2="19" y2="5" />
      <polyline points="10,5 19,5 19,14" />
    </svg>
  );
}

export function CloudIcon(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M6 16a3 3 0 0 1-.4-6A4.5 4.5 0 0 1 14 8.5a3.5 3.5 0 0 1 3.5 3.5A3.5 3.5 0 0 1 14 16z" />
    </svg>
  );
}

export function FreehandIcon(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M4 16c2-1 2-6 4-6s2 6 4 6 2-9 4-9 2 5 4 5" />
    </svg>
  );
}

export function TextIcon(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <polyline points="5,7 5,5 19,5 19,7" />
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="9" y1="19" x2="15" y2="19" />
    </svg>
  );
}

export function BlurIcon(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <line x1="8" y1="4" x2="4" y2="8" />
      <line x1="14" y1="4" x2="4" y2="14" />
      <line x1="20" y1="4" x2="4" y2="20" />
      <line x1="20" y1="10" x2="10" y2="20" />
      <line x1="20" y1="16" x2="16" y2="20" />
    </svg>
  );
}

export function UndoIcon(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <polyline points="9,7 4,12 9,17" />
      <path d="M4 12h11a5 5 0 0 1 0 10h-2" />
    </svg>
  );
}

export function RedoIcon(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <polyline points="15,7 20,12 15,17" />
      <path d="M20 12H9a5 5 0 0 0 0 10h2" />
    </svg>
  );
}

export function TrashIcon(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <polyline points="4,7 20,7" />
      <path d="M9 7V5h6v2" />
      <path d="M6 7l1 13h10l1-13" />
    </svg>
  );
}
