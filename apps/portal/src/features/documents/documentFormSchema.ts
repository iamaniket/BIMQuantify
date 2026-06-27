import { z } from 'zod';

import { DocumentStatusEnum, ModelDisciplineEnum } from '@/lib/api/schemas';

type Translator = (key: string) => string;

// Discipline is chosen at creation so the processor can honor it when generating
// the floor-plan artifact (architectural/coordination → plan; structural/mep →
// none; other → content auto-detect). It stays editable later from the document
// row's inline selector.
//
// Built as a factory so the Zod validation messages can be localized — pass a
// `useTranslations('…newDocumentDialog')` translator (the messages live under
// `validation.*`).
export function createDocumentFormSchema(t: Translator) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, { message: t('validation.nameRequired') })
      .max(255, { message: t('validation.nameMaxLength') }),
    discipline: ModelDisciplineEnum,
    status: DocumentStatusEnum,
  });
}

export type DocumentFormValues = z.infer<ReturnType<typeof createDocumentFormSchema>>;
