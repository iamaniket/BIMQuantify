/**
 * NL (Dutch) labels for the Verklaring kwaliteitsborger PDF (#32).
 *
 * The declaration body is a CONCEPT text — backlog #32 flags it as needing
 * Dutch IT-/construction-law review before commercial use; `draftNotice` makes
 * that explicit on the document. `{kb}` / `{instrument}` / `{address}` are
 * interpolated (and pre-escaped) by the template.
 */

export const NL_VERKLARING_LABELS = {
  reportTitle: 'Verklaring kwaliteitsborger',
  kicker: 'Wet kwaliteitsborging voor het bouwen (Wkb)',
  reference: 'Projectkenmerk',
  address: 'Adres',
  instrument: 'Toegelaten instrument',
  provider: 'Instrumentaanbieder',
  kwaliteitsborger: 'Kwaliteitsborger',
  generatedAt: 'Gegenereerd op',

  declarationHeading: 'Verklaring',
  declarationBody:
    'Hierbij verklaart {kb}, als kwaliteitsborger werkend met het toegelaten instrument {instrument}, ' +
    'dat het bouwwerk gelegen aan {address} naar zijn/haar oordeel een gerechtvaardigd vertrouwen biedt ' +
    'dat het voldoet aan de bouwtechnische voorschriften uit het Besluit bouwwerken leefomgeving (Bbl), ' +
    'op basis van de uitgevoerde kwaliteitsborging conform de Wet kwaliteitsborging voor het bouwen (Wkb).',
  draftNotice: 'Concept — deze verklaringstekst is nog niet juridisch beoordeeld.',

  signatureTitle: 'Ondertekening',
  signatureName: 'Naam kwaliteitsborger',
  signatureDate: 'Datum',
  signatureSignature: 'Handtekening',
  unsignedNotice: 'Nog niet ondertekend door de kwaliteitsborger.',

  signedStampTitle: 'Ondertekend',
  signedOn: 'Ondertekend op',
  signedBy: 'Door',
  auditHash: 'Audit-ID (SHA-256)',
} as const;

export type VerklaringLabels = {
  [K in keyof typeof NL_VERKLARING_LABELS]: (typeof NL_VERKLARING_LABELS)[K] extends Record<string, string>
    ? Record<string, string>
    : string;
};
