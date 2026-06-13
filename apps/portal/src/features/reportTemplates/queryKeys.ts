export const reportTemplatesKey = (reportType: string) =>
  ['report-templates', reportType] as const;

export const reportTemplateSchemaKey = (reportType: string, locale: string) =>
  ['report-templates', 'schema', reportType, locale] as const;
