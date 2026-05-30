import type { Attachment, AttachmentCategoryValue } from '@/lib/api/schemas/attachments';
import type { BuildingTypeValue } from '@/lib/api/schemas/projects';

type DossierRequirement = {
  category: AttachmentCategoryValue;
  labelKey: string;
};

const BASE_REQUIREMENTS: DossierRequirement[] = [
  { category: 'image', labelKey: 'photos' },
  { category: 'office', labelKey: 'documents' },
];

const DOSSIER_REQUIREMENTS: Record<BuildingTypeValue | 'default', DossierRequirement[]> = {
  dwelling: BASE_REQUIREMENTS,
  commercial: BASE_REQUIREMENTS,
  other: BASE_REQUIREMENTS,
  default: BASE_REQUIREMENTS,
};

export type DossierCompleteness = {
  filled: number;
  total: number;
  pct: number;
  categories: Array<DossierRequirement & { fulfilled: boolean; count: number }>;
};

export function computeDossierCompleteness(
  buildingType: BuildingTypeValue | null,
  attachments: Attachment[],
): DossierCompleteness {
  const requirements = DOSSIER_REQUIREMENTS[buildingType ?? 'default'];
  const ready = attachments.filter((a) => a.status === 'ready');

  const countByCategory = new Map<string, number>();
  for (const a of ready) {
    countByCategory.set(a.attachment_category, (countByCategory.get(a.attachment_category) ?? 0) + 1);
  }

  const categories = requirements.map((req) => {
    const count = countByCategory.get(req.category) ?? 0;
    return { ...req, fulfilled: count > 0, count };
  });

  const filled = categories.filter((c) => c.fulfilled).length;
  const total = categories.length;
  const pct = total > 0 ? Math.round((filled / total) * 100) : 0;

  return { filled, total, pct, categories };
}

export type CompletionPoint = { t: number; pct: number };

/**
 * Replays ready attachments oldest-first, recomputing dossier completion after
 * each so the curve steps 0→100 on the real timestamps the files arrived.
 */
export function buildCompletionSeries(
  buildingType: BuildingTypeValue | null,
  attachments: Attachment[],
): CompletionPoint[] {
  const requirements = DOSSIER_REQUIREMENTS[buildingType ?? 'default'];
  const total = requirements.length;
  if (total === 0) return [];

  const required = new Set(requirements.map((r) => r.category));
  const ready = attachments
    .filter((a) => a.status === 'ready')
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const fulfilled = new Set<string>();
  const points: CompletionPoint[] = [];
  for (const a of ready) {
    const before = fulfilled.size;
    if (required.has(a.attachment_category)) {
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
