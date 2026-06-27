import { z } from 'zod';

import { DocumentStatusEnum } from '@/lib/api/schemas';

type Translator = (key: string) => string;

// Discipline is intentionally omitted — it's optional at creation (defaults to
// "other" server-side) and set later from the document row's inline selector.
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
    status: DocumentStatusEnum,
  });
}

export type DocumentFormValues = z.infer<ReturnType<typeof createDocumentFormSchema>>;
