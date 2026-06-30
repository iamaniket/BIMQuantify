import type { CSSProperties, JSX } from 'react';

/**
 * The BimDossier brand mark, hand-authored as a **detailed inline SVG** (a
 * faithful vector twin of the 3D "dossier" render: a tabbed folder, a
 * dog-eared paper sheet, a glossy front flap with a concave pocket lip + 3D
 * thickness, and the house + 2×2 window + tower glyph on a ground line).
 * Proportions are traced from `assets/logos/brand-primary.png`.
 *
 * Why SVG and not the 1024² PNG: at small chrome sizes (header/footer ~40px)
 * on a standard-density (DPR-1) desktop the raster has only ~40 physical
 * pixels to spend on a busy 3D illustration, so it looks soft. Vectors render
 * at the device's native resolution and stay crisp at any size / pixel ratio.
 *
 * Two palettes:
 *  - `primary` — blue folder + white paper + white glyph, for light surfaces.
 *  - `white`   — white folder + blue paper + blue glyph, for primary-blue
 *                surfaces (auth hero, sidebars, the marketing brand panel).
 *
 * Gradient/filter ids are namespaced per variant (`-p` / `-w`). Multiple marks
 * of the same variant on one page share identical defs, which is valid — a
 * `url(#id)` reference resolves to the first matching def in document order.
 */
export type BrandMarkArtVariant = 'primary' | 'white';

export interface BrandMarkArtProps {
  size?: number;
  variant?: BrandMarkArtVariant;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  /** Accessible name; omit (and the mark renders decorative/aria-hidden). */
  title?: string | undefined;
}

interface Palette {
  id: string;
  backA: string;
  backB: string;
  flapA: string;
  flapB: string;
  flapC: string;
  side: string;
  rimO: number;
  paperA: string;
  paperB: string;
  fold: string;
  glyphA: string;
  glyphB: string;
  window: string;
  shadow: string;
  shadowO: number;
}

const PALETTES: Record<BrandMarkArtVariant, Palette> = {
  primary: {
    id: 'p',
    backA: '#3360a2',
    backB: '#1b3f7b',
    flapA: '#3f6bad',
    flapB: '#2c5697',
    flapC: '#193f7e',
    side: '#163970',
    rimO: 0.28,
    paperA: '#ffffff',
    paperB: '#d9dfe7',
    fold: '#b4bfce',
    glyphA: '#ffffff',
    glyphB: '#e7ebf1',
    window: '#2c5697',
    shadow: '#102449',
    shadowO: 0.2,
  },
  white: {
    id: 'w',
    backA: '#ffffff',
    backB: '#dbe4ee',
    flapA: '#ffffff',
    flapB: '#eef2f8',
    flapC: '#dbe3ee',
    side: '#c2cfe0',
    rimO: 0.5,
    paperA: '#4f7cbf',
    paperB: '#2c5697',
    fold: '#21487f',
    glyphA: '#2f5da3',
    glyphB: '#274f8e',
    window: '#ffffff',
    shadow: '#0c2148',
    shadowO: 0.28,
  },
};

export function BrandMarkArt({
  size = 32,
  variant = 'primary',
  className,
  style,
  title,
}: BrandMarkArtProps): JSX.Element {
  const p = PALETTES[variant];
  const i = p.id;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ flexShrink: 0, ...style }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <linearGradient id={`bdBack-${i}`} x1="0" y1="0" x2="0.1" y2="1">
          <stop offset="0" stopColor={p.backA} />
          <stop offset="1" stopColor={p.backB} />
        </linearGradient>
        <linearGradient id={`bdFlap-${i}`} x1="0" y1="0" x2="0.1" y2="1">
          <stop offset="0" stopColor={p.flapA} />
          <stop offset="0.4" stopColor={p.flapB} />
          <stop offset="1" stopColor={p.flapC} />
        </linearGradient>
        <linearGradient id={`bdPaper-${i}`} x1="0.1" y1="0" x2="0.25" y2="1">
          <stop offset="0" stopColor={p.paperA} />
          <stop offset="1" stopColor={p.paperB} />
        </linearGradient>
        <linearGradient id={`bdGlyph-${i}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.glyphA} />
          <stop offset="1" stopColor={p.glyphB} />
        </linearGradient>
        <filter id={`bdSoft-${i}`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.6" />
        </filter>
      </defs>

      {/* ground contact shadow */}
      <ellipse
        cx="68"
        cy="118"
        rx="47"
        ry="6.5"
        fill={p.shadow}
        opacity={p.shadowO}
        filter={`url(#bdSoft-${i})`}
      />

      {/* back panel + tab */}
      <path
        fill={`url(#bdBack-${i})`}
        d="M 8 58 V 17 Q 8 9 16 9 H 47 Q 55 9 55 17 V 20 H 106 Q 115 20 115 29 V 58 Z"
      />

      {/* paper sheet with dog-ear (mostly tucked behind the front flap) */}
      <path
        fill={`url(#bdPaper-${i})`}
        d="M 14 60 V 32 Q 14 21 26 20 L 99 17 L 116 33 V 60 Z"
      />
      <path fill={p.fold} d="M 99 17 L 116 33 L 98 35 Z" />

      {/* front-flap 3D thickness (right + bottom face) */}
      <path
        fill={p.side}
        d="M 14 60 H 112 Q 126 60 126 74 V 102 Q 126 117 112 117 H 14 Q 10 117 10 113 V 64 Q 10 60 14 60 Z"
      />

      {/* front-flap face: high lip with a gentle centre sag */}
      <path
        fill={`url(#bdFlap-${i})`}
        d="M 15 36 C 31 42, 48 44, 64 44 C 80 44, 97 40, 111 37 Q 122 37 122 51 V 100 Q 122 115 108 115 H 20 Q 6 115 6 100 V 50 Q 6 36 15 36 Z"
      />
      {/* soft upper sheen */}
      <ellipse cx="40" cy="60" rx="28" ry="11" fill="#ffffff" opacity="0.07" />
      {/* glossy highlight along the lip */}
      <path
        fill="#ffffff"
        opacity={p.rimO}
        d="M 15 36 C 31 42, 48 44, 64 44 C 80 44, 97 40, 111 37 Q 117 37 119 41 C 100 44, 84 47, 64 47 C 48 47, 31 45, 19 41 Q 11 39 15 36 Z"
      />

      {/* glyph: ground line + house + roof + tower */}
      <rect x="18" y="108" width="80" height="4.4" rx="2.2" fill={`url(#bdGlyph-${i})`} />
      <path fill={`url(#bdGlyph-${i})`} d="M 28 83 H 58 V 108 H 28 Z" />
      <path fill={`url(#bdGlyph-${i})`} d="M 23 84 L 43 67 L 63 84 Z" />
      <path fill={`url(#bdGlyph-${i})`} d="M 62 78 Q 62 75 65 75 H 79 Q 82 75 82 78 V 108 H 62 Z" />
      {/* 2×2 window */}
      <g fill={p.window}>
        <rect x="32" y="88" width="8.5" height="7" rx="1.4" />
        <rect x="43.5" y="88" width="8.5" height="7" rx="1.4" />
        <rect x="32" y="98" width="8.5" height="7" rx="1.4" />
        <rect x="43.5" y="98" width="8.5" height="7" rx="1.4" />
      </g>
    </svg>
  );
}
