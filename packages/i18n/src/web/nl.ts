import type { WebMessages } from './types.js';

export const webNlMessages: WebMessages = {
  metadata: {
    title: 'BimDossier',
    description: 'Wet kwaliteitsborging voor het bouwen (Wkb)-compliant digitaal dossier voor Nederlandse aannemers. Houd deadlines bij, beheer documenten, los bevindingen op en dien op tijd in.',
  },
  header: {
    brand: 'BimDossier',
    signIn: 'Inloggen',
    signOut: 'Uitloggen',
    features: 'Functies',
    blog: 'Blog',
    requestAccess: 'Toegang aanvragen',
  },
  hero: {
    badge: 'Early access — nu beschikbaar',
    headline: 'Nooit meer een Wet kwaliteitsborging voor het bouwen (Wkb)-deadline missen.',
    subtitle: 'BimDossier is het digitale dossierplatform voor Nederlandse aannemers. Houd bouwmelding- en gereedmeldingsdeadlines bij, beheer uw documenten, los bevindingen op en dien uw dossier bevoegd gezag op tijd in.',
    ctaPrimary: 'Vraag toegang aan',
    ctaSecondary: 'Inloggen',
  },
  features: {
    eyebrow: 'Mogelijkheden',
    headline: 'Alles wat een aannemer nodig heeft voor Wet kwaliteitsborging voor het bouwen (Wkb)-compliance',
    subtitle: 'Van projectstart tot gereedmelding — één platform voor uw hele Wet kwaliteitsborging voor het bouwen (Wkb)-dossier.',
    deadlines: {
      title: 'Deadlines bijhouden',
      body: 'Automatische berekening van bouwmelding-, informatieplicht- en gereedmeldingsdeadlines. E-mailherinneringen op T-30, T-14, T-7 en T-1 dagen zodat u geen indienmoment mist.',
    },
    dossier: {
      title: 'Dossiercompleetheid',
      body: 'Sjabloon-gebaseerde checklist per gebouwtype die precies laat zien welke documenten nog nodig zijn voor uw gereedmelding. Voortgangsbalk wordt bijgewerkt bij elke upload.',
    },
    findings: {
      title: 'Bevindingen beheren',
      body: 'Registreer inspectiebevindingen van uw kwaliteitsborger, wijs oplossingen toe en upload bewijsfoto\'s. Volg elke bevinding van open tot geverifieerd.',
    },
    certificates: {
      title: 'Certificatenbibliotheek',
      body: 'Upload getypeerde certificaten — CE/DoP-verklaringen, testrapporten, garanties — met vervaldatumbewaking. Ontvang automatische waarschuwingen voordat certificaten verlopen.',
    },
    viewer: {
      title: 'IFC-modelviewer',
      body: 'Bekijk en navigeer 3D BIM-modellen direct in de browser. Klik op elementen, bekijk eigenschappen en koppel inspecties aan specifieke bouwcomponenten.',
    },
    reports: {
      title: 'Compliancerapporten',
      body: 'Genereer audit-ready PDF-rapporten: borgingsplan, verklaring kwaliteitsborger en het volledige dossier bevoegd gezag-pakket.',
    },
  },
  howItWorks: {
    eyebrow: 'Hoe het werkt',
    headline: 'Van projectstart tot gereedmelding in vier stappen',
    step1: {
      title: 'Maak uw project aan',
      body: 'Voer het adres in met Nederlandse autocomplete, selecteer gebouwtype en gevolgklasse, stel geplande data in. Deadlines worden automatisch berekend.',
    },
    step2: {
      title: 'Upload documenten',
      body: 'Tekeningen, certificaten, KB-documenten — upload alles op één plek. De dossier-checklist laat zien wat er nog ontbreekt.',
    },
    step3: {
      title: 'Volg bevindingen',
      body: 'Registreer inspectiebevindingen, wijs oplossingen toe aan uw team, upload bewijsfoto\'s. Volledige levenscyclus van open tot geverifieerd.',
    },
    step4: {
      title: 'Dien op tijd in',
      body: 'E-mailherinneringen vóór elke deadline. Download het volledige dossierpakket voor gereedmelding bij het Omgevingsloket.',
    },
  },
  cta: {
    headline: 'Stop met documenten najagen. Begin op tijd in te dienen.',
    subtitle: 'Sluit u aan bij het early access programma. Krijg uw Wet kwaliteitsborging voor het bouwen (Wkb)-dossier onder controle vóór uw volgende deadline.',
    button: 'Vraag toegang aan',
  },
  footer: {
    tagline: 'Wet kwaliteitsborging voor het bouwen (Wkb)-compliant digitaal dossier voor Nederlandse aannemers.',
    product: 'Product',
    resources: 'Informatie',
    legal: 'Juridisch',
    privacy: 'Privacy',
    terms: 'Voorwaarden',
    dpa: 'DPA',
    copyright: 'BimDossier B.V.',
  },
  blog: {
    eyebrow: 'Blog',
    headline: 'Inzichten & updates',
    subtitle: 'Wet kwaliteitsborging voor het bouwen (Wkb)-compliance, Nederlandse bouwregelgeving en productupdates.',
    empty: 'Nog geen berichten. Kom snel terug.',
    readingTime: 'min leestijd',
  },
  languageToggle: {
    label: 'EN',
  },
  legalBrand: {
    backToSite: 'Terug naar site',
  },
  snagShowcase: {
    eyebrow: 'Kwaliteitsborging, live',
    headline: 'Vang gebreken voordat ze geld kosten.',
    subtitle: 'Sleep het model om het te inspecteren. Beweeg over een speld om de bevinding te lezen — de ernst, het Bbl-artikel dat het raakt, en waar het zit in de Wkb-borgingscyclus.',
    cta: 'Toegang aanvragen',
    hintDrag: 'Sleep om te draaien',
    hintHover: 'Beweeg over een speld voor details',
    learnMoreBlog: 'Lees hoe Wkb-borging werkt op de blog',
    fallbackTitle: 'Interactieve 3D-bevindingsinspectie',
    fallbackBody: 'Uw browser kan het live 3D-model niet tonen, maar dit zijn de bevindingen erin:',
    fallbackAlt: 'Interactief 3D-gebouwmodel met kwaliteitsborgingsbevindingen',
    severity: { low: 'Laag', medium: 'Middel', high: 'Hoog' },
    snags: {
      wall: 'Woningscheidende wand onvoldoende brandwerend',
      cover: 'Betondekking beneden minimum',
      pipe: 'Doorvoering leiding niet afgewerkt',
      airtight: 'Luchtdichtheidsmeting uitgesteld',
    },
  },
  metrics: {
    eyebrow: 'In cijfers',
    headline: 'Gebouwd voor de borgingscyclus',
    caption: 'Illustratieve cijfers.',
    snagsResolved: 'Bevindingen opgelost',
    compliancePassed: 'Compliancecontroles geslaagd',
    projects: 'Projecten in borging',
    avgDaysToClose: 'Gem. dagen tot afhandeling',
  },
  fromBlog: {
    eyebrow: 'Van de blog',
    headline: 'Wkb-inzichten & productupdates',
    readAll: 'Alle artikelen lezen',
    comingSoon: 'Binnenkort meer artikelen.',
  },
};
