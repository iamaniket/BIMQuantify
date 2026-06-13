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
});

export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
