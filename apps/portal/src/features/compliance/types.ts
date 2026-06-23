export type ComplianceSummary = {
  passCount: number;
  warnCount: number;
  failCount: number;
  overallScore: number;
  dossierPercentage: number;
  lastScanAt: string | null;
};

export type ComplianceDomain = {
  id: string;
  name: string;
  articleCount: number;
  pass: number;
  warn: number;
  fail: number;
};

export type ComplianceArticle = {
  code: string;
  title: string;
  categoryId: string;
  checks: number;
  pass: number;
  warn: number;
  fail: number;
};

export type ComplianceIssue = {
  id: string;
  bblCode: string;
  severity: 'fail' | 'warn';
  objectName: string;
  location: string;
  modelDiscipline: string;
  owner: string;
  createdAt: string;
  requirementText: string;
};

export type ComplianceTrend = number[];
