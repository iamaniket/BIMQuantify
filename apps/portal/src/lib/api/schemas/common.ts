import { z } from 'zod';

export const FileTypeEnum = z.enum(['ifc', 'pdf', 'dxf', 'dwg']);

export type FileTypeValue = z.infer<typeof FileTypeEnum>;

export const ModelDisciplineEnum = z.enum([
  'architectural',
  'structural',
  'mep',
  'coordination',
  'other',
]);

export type ModelDisciplineValue = z.infer<typeof ModelDisciplineEnum>;

export const ApiErrorBodySchema = z.object({
  detail: z.union([z.string(), z.array(z.unknown()), z.record(z.unknown())]),
  // Localized error envelope from the API (i18n/http_errors.py): `code` is the
  // stable SCREAMING_SNAKE code, `message` is already translated into the
  // request's Accept-Language. Optional so legacy/edge responses still parse.
  code: z.string().optional(),
  message: z.string().optional(),
});

export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
