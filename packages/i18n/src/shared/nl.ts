import type { SharedMessages } from './types.js';

export const sharedNlMessages: SharedMessages = {
  brand: {
    name: 'BimDossier',
    // Holdingmaatschappij is nog niet geregistreerd — toon voorlopig de kale
    // productnaam. Zet dit op de geregistreerde entiteit (bijv. "BimDossier B.V.").
    legalEntity: 'BimDossier',
    tagline: 'Het Wkb-dossierplatform voor Nederlandse aannemers.',
    productDescription:
      'Het Wkb-dossierplatform voor Nederlandse aannemers. Houd deadlines bij, beheer documenten, los bevindingen op en dien op tijd in.',
    pilotHeading: 'Word founding partner van BimDossier.',
  },
  legal: {
    privacy: 'Privacy',
    terms: 'Voorwaarden',
    dpa: 'Verwerkersovereenkomst',
    navAriaLabel: 'Juridisch',
  },
  framework: {
    wkb: {
      abbr: 'Wkb',
      full: 'Wet kwaliteitsborging voor het bouwen',
    },
    bbl: {
      abbr: 'Bbl',
      full: 'Besluit bouwwerken leefomgeving',
    },
  },
};
