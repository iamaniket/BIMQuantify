/**
 * Hardcoded demo project + Wkb findings behind the "touch the product"
 * workflow demo (`WorkflowDemoSection`). Mirrors the `demoSnags.ts` pattern:
 * translatable text is referenced by i18n key (`workflowDemo.*` in both
 * message catalogs); language-neutral literals (ids, Bbl article refs,
 * assignee initials, proper nouns like the project name and "Gevolgklasse 1")
 * stay here in TS so the i18n value-drift gate never sees them.
 */

export type DemoFindingStatus = 'open' | 'in_progress' | 'resolved';
export type DemoSeverity = 'low' | 'medium' | 'high';
export type DemoDiscipline = 'structure' | 'installations' | 'finishing' | 'facade';
export type DemoFindingKey =
  | 'kierdichting'
  | 'balustrade'
  | 'manchet'
  | 'ventilatie'
  | 'hwa'
  | 'dekking';

export type DemoFinding = {
  id: string;
  /** i18n: `workflowDemo.findings.<key>`. */
  titleKey: DemoFindingKey;
  severity: DemoSeverity;
  initialStatus: DemoFindingStatus;
  /** Label via `workflowDemo.disciplines.<key>`; also drives the bar chart. */
  discipline: DemoDiscipline;
  /** Literal Bbl article ref (like `demoSnags.ts`), or null when none applies. */
  bblArticleRef: string | null;
  /** Language-neutral initials shown on the card's assignee disc. */
  assigneeInitials: string;
  photoCount: number;
};

/**
 * Column order of the demo board. The move button advances a card one column
 * along it (and retreats one column from the final one).
 */
export const DEMO_COLUMNS: readonly DemoFindingStatus[] = ['open', 'in_progress', 'resolved'];

export const DEMO_PROJECT = {
  /** Proper noun — not translated. */
  name: 'Kadewoningen Havenkwartier',
  city: 'Zwolle',
  lat: 52.516,
  lng: 6.083,
  /** Statutory noun, identical in both locales by design (digit ≠ word). */
  gevolgklasseLabel: 'Gevolgklasse 1',
} as const;

export const DEMO_FINDINGS: readonly DemoFinding[] = [
  {
    id: 'bd-101',
    titleKey: 'kierdichting',
    severity: 'high',
    initialStatus: 'open',
    discipline: 'facade',
    bblArticleRef: '4.150',
    assigneeInitials: 'JB',
    photoCount: 2,
  },
  {
    id: 'bd-102',
    titleKey: 'balustrade',
    severity: 'high',
    initialStatus: 'open',
    discipline: 'structure',
    bblArticleRef: '4.21',
    assigneeInitials: 'MD',
    photoCount: 1,
  },
  {
    id: 'bd-103',
    titleKey: 'ventilatie',
    severity: 'medium',
    initialStatus: 'open',
    discipline: 'installations',
    bblArticleRef: '4.117',
    assigneeInitials: 'RK',
    photoCount: 1,
  },
  {
    id: 'bd-104',
    titleKey: 'manchet',
    severity: 'medium',
    initialStatus: 'in_progress',
    discipline: 'installations',
    bblArticleRef: '4.124',
    assigneeInitials: 'JB',
    photoCount: 3,
  },
  {
    id: 'bd-105',
    titleKey: 'hwa',
    severity: 'low',
    initialStatus: 'in_progress',
    discipline: 'installations',
    bblArticleRef: '3.24',
    assigneeInitials: 'SP',
    photoCount: 1,
  },
  {
    id: 'bd-106',
    titleKey: 'dekking',
    severity: 'medium',
    initialStatus: 'resolved',
    discipline: 'structure',
    bblArticleRef: '4.12',
    assigneeInitials: 'MD',
    photoCount: 2,
  },
];

/**
 * Static dashboard figures for the demo project. `dossierItemsComplete`
 * counts the non-finding checklist items — each resolved finding adds one on
 * top, so resolving all six closes the dossier at exactly `dossierItemsTotal`.
 */
export const DEMO_DASHBOARD = {
  dossierItemsTotal: 24,
  dossierItemsComplete: 18,
  deadlinesMet: 11,
  deadlinesTotal: 12,
  daysToGereedmelding: 46,
} as const;

/** The board's starting arrangement, keyed by finding id. */
export function initialStatusById(): Record<string, DemoFindingStatus> {
  const map: Record<string, DemoFindingStatus> = {};
  for (const finding of DEMO_FINDINGS) map[finding.id] = finding.initialStatus;
  return map;
}
