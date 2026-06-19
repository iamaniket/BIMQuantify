import { AVAILABLE_FEATURES, type FeatureItem } from '@/components/sections/featureCatalog';

export type FeatureImageAsset = {
  /** File under `public/features/<key>/`. Rendered only when `hasAssets` is true. */
  file: string;
};

export type FeatureContent = FeatureItem & {
  images: FeatureImageAsset[];
  /** Flip to `true` once real screenshots are committed under `public/features/<key>/`. */
  hasAssets: boolean;
};

/**
 * Non-localized structure for each feature detail page: which image tiles to
 * render and whether real assets exist yet. Localized copy (tagline, intro,
 * problem, solution bullets, image captions) lives in `messages/{en,nl}.json`
 * under `features.<key>.detail.*` — mirroring how `featureCatalog.ts` keeps the
 * icon/status out of the i18n catalogs.
 *
 * Every available feature ships three placeholder tiles; the matching
 * `detail.images` array in BOTH message catalogs MUST have the same length.
 */
const THREE_TILES: FeatureImageAsset[] = [
  { file: '01.png' },
  { file: '02.png' },
  { file: '03.png' },
];

const STRUCTURE: Record<string, { images: FeatureImageAsset[]; hasAssets: boolean }> = {
  deadlines: { images: THREE_TILES, hasAssets: false },
  dossier: { images: THREE_TILES, hasAssets: false },
  findings: { images: THREE_TILES, hasAssets: false },
  snagging: { images: THREE_TILES, hasAssets: false },
  board: { images: THREE_TILES, hasAssets: false },
  photos: { images: THREE_TILES, hasAssets: false },
  mobile: { images: THREE_TILES, hasAssets: false },
  viewer: { images: THREE_TILES, hasAssets: false },
  certificates: { images: THREE_TILES, hasAssets: false },
  reports: { images: THREE_TILES, hasAssets: false },
  bcf: { images: THREE_TILES, hasAssets: false },
  collaboration: { images: THREE_TILES, hasAssets: false },
};

/** The 12 available feature slugs (= catalog keys) backing `/features/<slug>`. */
export const FEATURE_SLUGS: string[] = AVAILABLE_FEATURES.map((f) => f.key);

/**
 * Resolve a feature by slug. Returns `null` for unknown slugs and for
 * `coming_soon` features (they aren't in `AVAILABLE_FEATURES`), so callers can
 * `notFound()` on either.
 */
export function getFeatureContent(slug: string): FeatureContent | null {
  const item = AVAILABLE_FEATURES.find((f) => f.key === slug);
  const structure = STRUCTURE[slug];
  if (item === undefined || structure === undefined) {
    return null;
  }
  return { ...item, ...structure };
}
