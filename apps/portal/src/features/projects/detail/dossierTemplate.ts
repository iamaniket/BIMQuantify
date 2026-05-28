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
