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
  group: string;
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

export type ActivityItem = {
  id: string;
  type: 'upload' | 'scan' | 'pin' | 'fix' | 'report';
  actor: string;
  description: string;
  detail: string;
  timestamp: string;
};

export type DossierSection = {
  name: string;
  percentage: number;
  itemsDone: number;
  itemsTotal: number;
};

export type DossierData = {
  overallPercentage: number;
  holdbackAmount: string;
  sections: DossierSection[];
};

export type ComplianceTrend = number[];
