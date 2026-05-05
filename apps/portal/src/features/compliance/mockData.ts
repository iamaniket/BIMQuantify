import type {
  ComplianceSummary,
  ComplianceDomain,
  ComplianceArticle,
  ComplianceIssue,
  ActivityItem,
  DossierData,
  ComplianceTrend,
} from './types';

export const MOCK_COMPLIANCE_SUMMARY: ComplianceSummary = {
  passCount: 1109,
  warnCount: 79,
  failCount: 28,
  overallScore: 82,
  dossierPercentage: 85,
  lastScanAt: new Date(Date.now() - 26 * 60 * 1000).toISOString(),
};

export const MOCK_DOMAINS: ComplianceDomain[] = [
  { id: 'fire_safety', name: 'fire_safety', articleCount: 3, pass: 618, warn: 51, fail: 23 },
  { id: 'accessibility', name: 'accessibility', articleCount: 2, pass: 194, warn: 6, fail: 0 },
  { id: 'sustainability', name: 'sustainability', articleCount: 2, pass: 49, warn: 10, fail: 1 },
  { id: 'structural', name: 'structural', articleCount: 1, pass: 248, warn: 12, fail: 4 },
];

export const MOCK_ARTICLES: ComplianceArticle[] = [
  { categoryId: 'Brandveiligheid', code: 'Bbl 4.30', title: 'Beperking uitbreiding brand', checks: 412, pass: 386, warn: 18, fail: 8 },
  { categoryId: 'Brandveiligheid', code: 'Bbl 4.40', title: 'Vluchtroutes', checks: 184, pass: 162, warn: 14, fail: 8 },
  { categoryId: 'Brandveiligheid', code: 'Bbl 4.51', title: 'Rookcompartimentering', checks: 96, pass: 70, warn: 19, fail: 7 },
  { categoryId: 'Toegankelijkheid', code: 'Bbl 4.21', title: 'Toegankelijkheidssector', checks: 58, pass: 56, warn: 2, fail: 0 },
  { categoryId: 'Toegankelijkheid', code: 'Bbl 4.24', title: 'Doorgangen & vrije breedte', checks: 142, pass: 138, warn: 4, fail: 0 },
  { categoryId: 'Milieu', code: 'Bbl 4.159', title: 'Milieuprestatie (MPG)', checks: 24, pass: 19, warn: 4, fail: 1 },
  { categoryId: 'Milieu', code: 'Bbl 4.161', title: 'Energiezuinigheid (BENG)', checks: 36, pass: 30, warn: 6, fail: 0 },
  { categoryId: 'Constructie', code: 'Bbl 4.12', title: 'Sterkte bouwconstructie', checks: 264, pass: 248, warn: 12, fail: 4 },
];

export const MOCK_ISSUES: ComplianceIssue[] = [
  { id: 'I-2041', bblCode: 'Bbl 4.30', severity: 'fail', objectName: 'WL-204 (wand)', location: 'B3 · sector 2', modelDiscipline: 'FIRE', owner: 'M. Janssen', createdAt: '2h', requirementText: 'Bbl-artikel vereist WBDBO ≥ 60 minuten tussen brandcompartimenten.' },
  { id: 'I-2039', bblCode: 'Bbl 4.51', severity: 'fail', objectName: 'DR-117 (deur)', location: 'B2 · trap-N', modelDiscipline: 'FIRE', owner: 'M. Janssen', createdAt: '3h', requirementText: 'Bbl-artikel vereist rookwerendheid ≥ 30 minuten voor scheidingsconstructie.' },
  { id: 'I-2036', bblCode: 'Bbl 4.40', severity: 'warn', objectName: 'Route R-08', location: 'B1 → uitgang', modelDiscipline: 'ARCH', owner: 'B. Akkerman', createdAt: '5h', requirementText: 'Bbl-artikel vereist vluchtroute breedte ≥ 850mm.' },
  { id: 'I-2030', bblCode: 'Bbl 4.30', severity: 'fail', objectName: 'PEN-441 (sparing)', location: 'B4 · plafond', modelDiscipline: 'MEP', owner: 'S. de Wit', createdAt: '8h', requirementText: 'Bbl-artikel vereist WBDBO ≥ 60 minuten tussen brandcompartimenten.' },
  { id: 'I-2024', bblCode: 'Bbl 4.24', severity: 'warn', objectName: 'Doorgang DG-12', location: 'B0 · entree', modelDiscipline: 'ACC', owner: 'R. Bakker', createdAt: '1d', requirementText: 'Bbl-artikel vereist vrije breedte ≥ 900mm bij doorgangen.' },
  { id: 'I-2018', bblCode: 'Bbl 4.12', severity: 'warn', objectName: 'Kolom K-22', location: 'B2 · kern', modelDiscipline: 'STR', owner: 'T. Visser', createdAt: '1d', requirementText: 'Bbl-artikel vereist compliance binnen geldende norm.' },
  { id: 'I-2014', bblCode: 'Bbl 4.159', severity: 'fail', objectName: 'Gevelpaneel GP-04', location: 'Gevel-N', modelDiscipline: 'ENV', owner: 'K. Mulder', createdAt: '2d', requirementText: 'Bbl-artikel vereist MPG ≤ 0.8 per m² GBO.' },
  { id: 'I-2008', bblCode: 'Bbl 4.161', severity: 'warn', objectName: 'Glasvlak GV-118', location: 'B3 · zuid', modelDiscipline: 'ENV', owner: 'K. Mulder', createdAt: '2d', requirementText: 'Bbl-artikel vereist BENG-2 ≤ 25 kWh/m².' },
];

export const MOCK_ACTIVITY: ActivityItem[] = [
  { id: '1', type: 'upload', actor: 'S. de Wit', description: 'Installaties · v09.ifc', detail: '+1,402 elements · 18 fixes', timestamp: '23 min' },
  { id: '2', type: 'scan', actor: 'BimStitch', description: 'Compliance scan finished', detail: '1,216 checks · 71 issues', timestamp: '26 min' },
  { id: '3', type: 'pin', actor: 'J. Hofman', description: 'Pinned cert. to wall WL-204', detail: 'EN 13501-1 A2-s1,d0', timestamp: '1h' },
  { id: '4', type: 'fix', actor: 'M. Janssen', description: 'Resolved 4 fire issues', detail: 'Bbl 4.30 · sector B', timestamp: '2h' },
  { id: '5', type: 'upload', actor: 'B. Akkerman', description: 'Architectuur · v07.ifc', detail: '+62 doors retagged', timestamp: '2h' },
  { id: '6', type: 'pin', actor: 'Site team', description: '12 inspection photos', detail: 'Floor 3 · stairwells', timestamp: '5h' },
  { id: '7', type: 'scan', actor: 'BimStitch', description: 'Auto-scan: routes', detail: 'Bbl 4.24 · 142 checks', timestamp: '6h' },
  { id: '8', type: 'report', actor: 'L. van der Berg', description: 'Inspector signed off F2', detail: 'Holdback unlock 30%', timestamp: '1d' },
];

export const MOCK_DOSSIER: DossierData = {
  overallPercentage: 85,
  holdbackAmount: '€ 184,500',
  sections: [
    { name: 'As-built tekeningen', percentage: 96, itemsDone: 248, itemsTotal: 258 },
    { name: 'Productcertificaten', percentage: 84, itemsDone: 412, itemsTotal: 491 },
    { name: 'Installatie-rapporten', percentage: 72, itemsDone: 58, itemsTotal: 80 },
    { name: 'Inspectielogs (foto\'s)', percentage: 91, itemsDone: 1824, itemsTotal: 2001 },
    { name: 'Onderhoudsvoorschriften', percentage: 100, itemsDone: 62, itemsTotal: 62 },
    { name: 'Risicobeoordelingen', percentage: 68, itemsDone: 17, itemsTotal: 25 },
  ],
};

export const MOCK_TREND: ComplianceTrend = (() => {
  const data: number[] = [];
  let v = 64;
  for (let i = 0; i < 30; i++) {
    v += Math.sin(i / 3) * 1.6 + (Math.random() * 1.2 - 0.5) + 0.4;
    v = Math.max(58, Math.min(96, v));
    data.push(Math.round(v * 10) / 10);
  }
  return data;
})();
