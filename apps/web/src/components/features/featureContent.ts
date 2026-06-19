import type { AppIcon } from '@bimstitch/ui/icons';

import { AVAILABLE_FEATURES, type FeatureItem } from '@/components/sections/featureCatalog';

import bcf from '@/content/features/bcf.json';
import board from '@/content/features/board.json';
import certificates from '@/content/features/certificates.json';
import collaboration from '@/content/features/collaboration.json';
import deadlines from '@/content/features/deadlines.json';
import dossier from '@/content/features/dossier.json';
import findings from '@/content/features/findings.json';
import mobile from '@/content/features/mobile.json';
import photos from '@/content/features/photos.json';
import reports from '@/content/features/reports.json';
import snagging from '@/content/features/snagging.json';
import viewer from '@/content/features/viewer.json';

/**
 * Per-feature content lives in one self-contained bilingual JSON file each,
 * under `src/content/features/<key>.json` — the single source of truth for the
 * marketing feature pages (title, card, tagline, intro, problem/solution,
 * highlights, FAQ, image paths + captions, SEO keywords), in both `en` and `nl`.
 * Editing a feature means editing one file. The only things that stay OUT of the
 * JSON are the Phosphor `icon` and `status`, which come from `featureCatalog.ts`
 * (an icon is a component, not serialisable content).
 *
 * Chrome that is shared across all feature pages (section headings, "Read more",
 * the capabilities-grid eyebrow/headline) still lives in `messages/{en,nl}.json`
 * under `features.*` / `featureDetail.*`.
 */
export type FeatureHighlight = { title: string; body: string };
export type FeatureFaqItem = { q: string; a: string };

/** One locale's worth of a feature's copy. Shape is identical for `en` / `nl`. */
export type FeatureLocaleContent = {
  title: string;
  /** Short description shown on the capabilities-grid card (was `features.<key>.body`). */
  card: string;
  tagline: string;
  intro: string;
  problemTitle: string;
  problem: string;
  solutionTitle: string;
  solution: string[];
  highlights: FeatureHighlight[];
  faq: FeatureFaqItem[];
  /** One caption per entry in `images`, same order. */
  imageCaptions: string[];
  /** SEO keywords / tags for `generateMetadata`. */
  keywords: string[];
};

/** The raw shape of a `src/content/features/<key>.json` file. */
export type FeatureJson = {
  key: string;
  /** Flip to `true` once real screenshots are committed under `public/features/<key>/`. */
  hasAssets: boolean;
  /** Public image paths (e.g. `/features/<key>/01.png`); same length as `imageCaptions`. */
  images: string[];
  /** Sibling feature slugs cross-linked from the "Related capabilities" strip. */
  related: string[];
  en: FeatureLocaleContent;
  nl: FeatureLocaleContent;
};

/** A feature resolved for a single locale: catalog icon/status + JSON content. */
export type FeatureContent = FeatureLocaleContent & {
  key: string;
  icon: AppIcon;
  status: FeatureItem['status'];
  hasAssets: boolean;
  images: string[];
  related: string[];
};

const RAW: Record<string, FeatureJson> = {
  deadlines,
  dossier,
  findings,
  snagging,
  board,
  photos,
  mobile,
  viewer,
  certificates,
  reports,
  bcf,
  collaboration,
};

/** The 12 available feature slugs (= catalog keys) backing `/features/<slug>`. */
export const FEATURE_SLUGS: string[] = AVAILABLE_FEATURES.map((f) => f.key);

/**
 * Resolve a feature by slug for a given locale. Returns `null` for unknown slugs
 * and for `coming_soon` features (they aren't in `AVAILABLE_FEATURES`), so callers
 * can `notFound()` on either. Unknown locales fall back to English.
 */
export function getFeatureContent(slug: string, locale: string): FeatureContent | null {
  const raw = RAW[slug];
  const item = AVAILABLE_FEATURES.find((f) => f.key === slug);
  if (raw === undefined || item === undefined) {
    return null;
  }
  const loc = locale === 'nl' ? raw.nl : raw.en;
  return {
    key: slug,
    icon: item.icon,
    status: item.status,
    hasAssets: raw.hasAssets,
    images: raw.images,
    related: raw.related,
    ...loc,
  };
}
