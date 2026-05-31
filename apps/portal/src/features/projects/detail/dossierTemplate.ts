import type { Attachment } from '@/lib/api/schemas/attachments';
import type { BuildingTypeValue } from '@/lib/api/schemas/projects';

export type DossierCategoryResult = {
  category: string;
  labelKey: string;
  fulfilled: boolean;
  count: number;
  detail?: string;
};

export type DossierCompleteness = {
  filled: number;
  total: number;
  pct: number;
  categories: DossierCategoryResult[];
};

export type DossierExtraInput = {
  modelCount?: number;
  certificateCount?: number;
  findingsOpen?: number;
  deadlinesOverdue?: number;
};

export function computeDossierCompleteness(
  buildingType: BuildingTypeValue | null,
  attachments: Attachment[],
  extra: DossierExtraInput = {},
): DossierCompleteness {
  const {
    modelCount = 0,
    certificateCount = 0,
    findingsOpen = 0,
    deadlinesOverdue = 0,
  } = extra;

  const ready = attachments.filter((a) => a.status === 'ready');

  const countByCategory = new Map<string, number>();
  for (const a of ready) {
    countByCategory.set(a.attachment_category, (countByCategory.get(a.attachment_category) ?? 0) + 1);
  }

  const photoCount = countByCategory.get('image') ?? 0;
  const documentCount = countByCategory.get('office') ?? 0;

  const categories: DossierCategoryResult[] = [
    {
      category: 'models',
      labelKey: 'models',
      fulfilled: modelCount > 0,
      count: modelCount,
    },
    {
      category: 'documents',
      labelKey: 'documents',
      fulfilled: documentCount > 0,
      count: documentCount,
    },
    {
      category: 'photos',
      labelKey: 'photos',
      fulfilled: photoCount > 0,
      count: photoCount,
    },
    {
      category: 'certificates',
      labelKey: 'certificates',
      fulfilled: certificateCount > 0,
      count: certificateCount,
    },
    {
      category: 'findings',
      labelKey: 'findings',
      fulfilled: findingsOpen === 0,
      count: findingsOpen,
      detail: findingsOpen > 0 ? 'findingsOpenDetail' : 'findingsResolved',
    },
    {
      category: 'deadlines',
      labelKey: 'deadlines',
      fulfilled: deadlinesOverdue === 0,
      count: deadlinesOverdue,
      detail: deadlinesOverdue > 0 ? 'deadlinesOverdueDetail' : 'deadlinesOnTrack',
    },
  ];

  // Ignore building type for now — same 6 categories for all types.
  void buildingType;

  const filled = categories.filter((c) => c.fulfilled).length;
  const total = categories.length;
  const pct = total > 0 ? Math.round((filled / total) * 100) : 0;

  return { filled, total, pct, categories };
}

export type CompletionPoint = { t: number; pct: number };

/**
 * Replays ready attachments oldest-first, tracking when attachment-based
 * categories (photos, documents) became fulfilled. This only covers the
 * attachment portion of dossier completeness — the other categories (models,
 * certificates, findings, deadlines) are point-in-time and don't have
 * historical progression data.
 */
export function buildCompletionSeries(
  _buildingType: BuildingTypeValue | null,
  attachments: Attachment[],
): CompletionPoint[] {
  // Track fulfillment of attachment-based categories: image, office
  const requiredCategories = new Set(['image', 'office']);
  const total = requiredCategories.size;
  if (total === 0) return [];

  const ready = attachments
    .filter((a) => a.status === 'ready')
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const fulfilled = new Set<string>();
  const points: CompletionPoint[] = [];
  for (const a of ready) {
    const before = fulfilled.size;
    if (requiredCategories.has(a.attachment_category)) {
      fulfilled.add(a.attachment_category);
    }
    if (fulfilled.size !== before) {
      points.push({
        t: new Date(a.created_at).getTime(),
        pct: Math.round((fulfilled.size / total) * 100),
      });
    }
  }
  return points;
}
