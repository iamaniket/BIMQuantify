/**
 * NL (Dutch) labels for the Borgingsplan PDF (#31). Sibling to labels.ts;
 * adding DE/BE = a sibling file + a registry entry in ../../assurance-plan.ts.
 *
 * The code→label maps (phases / risk categories / levels / evidence types)
 * mirror the neutral enum codes the API sends, so the worker stays free of the
 * jurisdiction registry — the labels travel with the template, not the payload.
 */

export const NL_ASSURANCE_PLAN_LABELS = {
  reportTitle: 'Borgingsplan',
  reference: 'Projectkenmerk',
  address: 'Adres',
  kwaliteitsborger: 'Kwaliteitsborger',
  version: 'Versie',
  status: 'Status',
  generatedAt: 'Gegenereerd op',

  sectionRisks: 'Risicobeoordeling',
  sectionMoments: 'Borgingsmomenten',

  category: 'Categorie',
  level: 'Risiconiveau',
  riskDescription: 'Risico',
  mitigation: 'Beheersmaatregel',
  responsibleParty: 'Verantwoordelijke',
  article: 'Bbl-artikel',
  noRisks: "Geen risico's vastgelegd.",

  noMoments: 'Geen borgingsmomenten vastgelegd.',
  plannedDate: 'Gepland',
  actualDate: 'Uitgevoerd',
  responsible: 'Verantwoordelijke',
  evidence: 'Bewijs',
  criteria: 'Criterium',
  checklistItem: 'Controlepunt',

  signatureTitle: 'Ondertekening kwaliteitsborger',
  signatureName: 'Naam',
  signatureSignature: 'Handtekening',
  signatureDate: 'Datum',

  planStatus: {
    draft: 'Concept',
    published: 'Gepubliceerd',
    superseded: 'Vervangen',
  } as Record<string, string>,

  phases: {
    foundation: 'Fundering',
    shell: 'Ruwbouw',
    roof: 'Dak',
    finishing: 'Afbouw',
    handover: 'Oplevering',
    other: 'Overig',
  } as Record<string, string>,

  riskCategories: {
    structural_safety: 'Constructieve veiligheid',
    fire_safety: 'Brandveiligheid',
    health: 'Gezondheid',
    energy_efficiency: 'Energiezuinigheid',
    usability: 'Bruikbaarheid',
  } as Record<string, string>,

  riskLevels: {
    low: 'Laag',
    medium: 'Midden',
    high: 'Hoog',
  } as Record<string, string>,

  evidenceTypes: {
    photo: 'Foto',
    certificate: 'Certificaat',
    measurement: 'Meting',
    document: 'Document',
    signature: 'Handtekening',
  } as Record<string, string>,
} as const;

export type AssurancePlanLabels = {
  [K in keyof typeof NL_ASSURANCE_PLAN_LABELS]: (typeof NL_ASSURANCE_PLAN_LABELS)[K] extends Record<string, string>
    ? Record<string, string>
    : string;
};
