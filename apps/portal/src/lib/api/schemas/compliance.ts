import { z } from 'zod';

export const CheckResultItemSchema = z.object({
  rule_id: z.string(),
  article: z.string(),
  element_global_id: z.string(),
  element_type: z.union([z.string(), z.null()]).optional(),
  element_name: z.union([z.string(), z.null()]).optional(),
  status: z.enum(['pass', 'fail', 'warn', 'skip', 'error']),
  message: z.string(),
  actual_value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  expected_value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  property_set: z.union([z.string(), z.null()]).optional(),
  property_name: z.union([z.string(), z.null()]).optional(),
  severity: z.string(),
});

export type CheckResultItem = z.infer<typeof CheckResultItemSchema>;

export const RuleSummaryItemSchema = z.object({
  rule_id: z.string(),
  article: z.string(),
  titles: z.record(z.string(), z.string()).optional(),
  title: z.string().nullish(),
  title_nl: z.string().nullish(),
  category: z.string(),
  severity: z.string(),
  total_checked: z.number(),
  passed: z.number(),
  failed: z.number(),
  warned: z.number(),
  skipped: z.number(),
  errors: z.number(),
});

export type RuleSummaryItem = z.infer<typeof RuleSummaryItemSchema>;

export const CategorySummaryItemSchema = z.object({
  category: z.string(),
  total_rules: z.number(),
  total_checks: z.number(),
  passed: z.number(),
  failed: z.number(),
  warned: z.number(),
});

export type CategorySummaryItem = z.infer<typeof CategorySummaryItemSchema>;

export const ComplianceCheckResponseSchema = z.object({
  file_id: z.string(),
  job_id: z.string().uuid(),
  checked_at: z.string(),
  total_rules: z.number(),
  total_elements_checked: z.number(),
  rules_summary: z.array(RuleSummaryItemSchema),
  category_summary: z.array(CategorySummaryItemSchema),
  details: z.array(CheckResultItemSchema),
});

export type ComplianceCheckResponse = z.infer<typeof ComplianceCheckResponseSchema>;

export const ComplianceSummaryResponseSchema = z.object({
  file_id: z.string(),
  job_id: z.string().uuid(),
  checked_at: z.string(),
  total_rules: z.number(),
  total_elements_checked: z.number(),
  rules_summary: z.array(RuleSummaryItemSchema),
  category_summary: z.array(CategorySummaryItemSchema),
});

export type ComplianceSummaryResponse = z.infer<typeof ComplianceSummaryResponseSchema>;

export const ComplianceFrameworkEnum = z.enum(['bbl', 'wkb']);

export type ComplianceFramework = z.infer<typeof ComplianceFrameworkEnum>;

export const ProjectComplianceReportItemSchema = z.object({
  job_id: z.string().uuid(),
  file_id: z.string().uuid(),
  document_id: z.string().uuid(),
  document_name: z.string(),
  document_discipline: z.string(),
  file_name: z.string(),
  file_version: z.number().int(),
  framework: ComplianceFrameworkEnum,
  checked_at: z.string(),
  finished_at: z.string(),
  pass_count: z.number().int(),
  warn_count: z.number().int(),
  fail_count: z.number().int(),
  total_rules: z.number().int(),
  total_elements_checked: z.number().int(),
  overall_score: z.number().int(),
});

export type ProjectComplianceReportItem = z.infer<typeof ProjectComplianceReportItemSchema>;

export const ProjectComplianceReportListSchema = z.object({
  items: z.array(ProjectComplianceReportItemSchema),
});

export type ProjectComplianceReportList = z.infer<typeof ProjectComplianceReportListSchema>;
