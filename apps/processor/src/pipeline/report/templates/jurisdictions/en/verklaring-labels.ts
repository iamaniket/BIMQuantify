/**
 * EN (English) labels for the Verklaring kwaliteitsborger PDF (#32). Mirrors
 * `../nl/verklaring-labels.ts` — same shape, translated. The declaration body
 * stays in Dutch because it is a legal text tied to the Dutch Wkb regulation.
 */

import type { VerklaringLabels } from '../nl/verklaring-labels.js';

export const EN_VERKLARING_LABELS: VerklaringLabels = {
  reportTitle: 'Quality Assurance Declaration',
  kicker: 'Quality Assurance for Building Act (Wkb)',
  reference: 'Project reference',
  address: 'Address',
  kwaliteitsborger: 'Quality assurance inspector',
  generatedAt: 'Generated at',

  declarationHeading: 'Declaration',
  // Legal text — intentionally kept in Dutch (Dutch regulatory artifact).
  declarationBody:
    'Hierbij verklaart {kb}, als kwaliteitsborger, ' +
    'dat het bouwwerk gelegen aan {address} naar zijn/haar oordeel een gerechtvaardigd vertrouwen biedt ' +
    'dat het voldoet aan de bouwtechnische voorschriften uit het Besluit bouwwerken leefomgeving (Bbl), ' +
    'op basis van de uitgevoerde kwaliteitsborging conform de Wet kwaliteitsborging voor het bouwen (Wkb).',
  draftNotice: 'Draft — this declaration text has not yet been legally reviewed.',

  signatureTitle: 'Signature',
  signatureName: 'Name of quality assurance inspector',
  signatureDate: 'Date',
  signatureSignature: 'Signature',
  unsignedNotice: 'Not yet signed by the quality assurance inspector.',

  signedStampTitle: 'Signed',
  signedOn: 'Signed on',
  signedBy: 'By',
  auditHash: 'Audit ID (SHA-256)',
} as const;
