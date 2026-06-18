import type { WebMessages } from './types.js';

export const webEnMessages: WebMessages = {
  metadata: {
    title: 'BimDossier',
    description: 'Quality Assurance in Construction Act (Wkb)-compliant digital dossier for Dutch contractors. Track deadlines, manage documents, resolve findings, and file on time.',
  },
  header: {
    brand: 'BimDossier',
    signIn: 'Log in',
    signOut: 'Sign out',
    features: 'Features',
    blog: 'Blog',
    requestAccess: 'Request access',
  },
  hero: {
    badge: 'Early access — now open',
    headline: 'Never miss a Quality Assurance in Construction Act (Wkb) deadline again.',
    subtitle: 'BimDossier is the digital dossier platform for Dutch contractors. Track bouwmelding and gereedmelding deadlines, manage your documents, resolve findings, and file your dossier bevoegd gezag on time.',
    ctaPrimary: 'Get early access',
    ctaSecondary: 'Log in',
  },
  features: {
    eyebrow: 'Capabilities',
    headline: 'Everything a contractor needs for Quality Assurance in Construction Act (Wkb) compliance',
    subtitle: 'From project kickoff to gereedmelding — one platform for your entire Quality Assurance in Construction Act (Wkb) dossier.',
    deadlines: {
      title: 'Deadline tracking',
      body: 'Automatic computation of bouwmelding, informatieplicht, and gereedmelding deadlines. Email reminders at T-30, T-14, T-7, and T-1 days so you never miss a filing.',
    },
    dossier: {
      title: 'Dossier completeness',
      body: 'Template-based checklist per building type showing exactly which documents are still needed for your gereedmelding. Progress bar updates as you upload.',
    },
    findings: {
      title: 'Finding management',
      body: 'Log inspection findings from your kwaliteitsborger, assign resolution, and upload evidence photos. Track every finding from open to verified.',
    },
    certificates: {
      title: 'Certificate library',
      body: 'Upload typed certificates — CE/DoP declarations, test reports, warranties — with expiry tracking. Get automatic warnings before certificates expire.',
    },
    viewer: {
      title: 'IFC model viewer',
      body: 'View and navigate 3D BIM models directly in the browser. Click elements, inspect properties, and link inspections to specific building components.',
    },
    reports: {
      title: 'Compliance reports',
      body: 'Generate audit-ready PDF reports: borgingsplan, verklaring kwaliteitsborger, and the complete dossier bevoegd gezag package.',
    },
  },
  howItWorks: {
    eyebrow: 'How it works',
    headline: 'From project start to gereedmelding in four steps',
    step1: {
      title: 'Create your project',
      body: 'Enter the address with Dutch autocomplete, select building type and gevolgklasse, set planned dates. Deadlines are computed automatically.',
    },
    step2: {
      title: 'Upload documents',
      body: 'Drawings, certificates, KB documents — upload everything in one place. The dossier checklist shows what is still missing.',
    },
    step3: {
      title: 'Track findings',
      body: 'Log inspection findings, assign resolution to your team, upload evidence photos. Full lifecycle from open to verified.',
    },
    step4: {
      title: 'File on time',
      body: 'Email reminders before every deadline. Download the complete dossier package for gereedmelding filing at the Omgevingsloket.',
    },
  },
  cta: {
    headline: 'Stop chasing documents. Start filing on time.',
    subtitle: 'Join the early access program. Get your Quality Assurance in Construction Act (Wkb) dossier under control before your next deadline.',
    button: 'Get early access',
  },
  footer: {
    tagline: 'Quality Assurance in Construction Act (Wkb)-compliant digital dossier for Dutch contractors.',
    product: 'Product',
    resources: 'Resources',
    legal: 'Legal',
    privacy: 'Privacy',
    terms: 'Terms',
    dpa: 'DPA',
    copyright: 'BimDossier B.V.',
  },
  blog: {
    eyebrow: 'Blog',
    headline: 'Insights & updates',
    subtitle: 'Quality Assurance in Construction Act (Wkb) compliance, Dutch building regulations, and product updates.',
    empty: 'No posts yet. Check back soon.',
    readingTime: 'min read',
  },
  languageToggle: {
    label: 'NL',
  },
  legalBrand: {
    backToSite: 'Back to site',
  },
  snagShowcase: {
    eyebrow: 'Quality assurance, live',
    headline: 'Catch defects before they cost you.',
    subtitle: 'Drag the model to inspect it. Hover a pin to read the snag — its severity, the Bbl article it touches, and where it sits in the Wkb borging loop.',
    cta: 'Request access',
    hintDrag: 'Drag to rotate',
    hintHover: 'Hover a pin for details',
    learnMoreBlog: 'Learn how Wkb borging works on the blog',
    fallbackTitle: 'Interactive 3D snag inspection',
    fallbackBody: 'Your browser cannot show the live 3D model, but here are the snags it carries:',
    fallbackAlt: 'Interactive 3D building model with quality-assurance snags',
    severity: { low: 'Low', medium: 'Medium', high: 'High' },
    snags: {
      wall: 'Party-wall fire rating not met',
      cover: 'Concrete cover below minimum',
      pipe: 'Pipe penetration not sealed',
      airtight: 'Airtightness test outstanding',
    },
  },
  metrics: {
    eyebrow: 'By the numbers',
    headline: 'Built for the borging loop',
    caption: 'Illustrative figures.',
    snagsResolved: 'Snags resolved',
    compliancePassed: 'Compliance checks passed',
    projects: 'Projects under borging',
    avgDaysToClose: 'Avg. days to close a snag',
  },
  fromBlog: {
    eyebrow: 'From the blog',
    headline: 'Wkb insights & product updates',
    readAll: 'Read all posts',
    comingSoon: 'More articles coming soon.',
  },
};
