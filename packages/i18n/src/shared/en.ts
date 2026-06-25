import type { SharedMessages } from './types.js';

export const sharedEnMessages: SharedMessages = {
  brand: {
    name: 'BimDossier',
    // Holding/parent entity is not registered yet — show the plain product name
    // until it is. Set this to the registered entity (e.g. "BimDossier B.V.") then.
    legalEntity: 'BimDossier',
    tagline: 'The Wkb dossier platform for Dutch contractors.',
    productDescription:
      'The Wkb dossier platform for Dutch contractors. Track deadlines, manage documents, resolve findings, and file on time.',
    pilotHeading: 'Join the BimDossier pilot.',
  },
  legal: {
    privacy: 'Privacy',
    terms: 'Terms',
    dpa: 'DPA',
    navAriaLabel: 'Legal',
  },
  framework: {
    wkb: {
      abbr: 'Wkb',
      full: 'Quality Assurance in Construction Act',
    },
    bbl: {
      abbr: 'Bbl',
      full: 'Besluit bouwwerken leefomgeving',
    },
  },
};
