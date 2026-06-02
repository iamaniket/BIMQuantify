export type WebMessages = {
  metadata: {
    title: string;
    description: string;
  };
  header: {
    brand: string;
    signIn: string;
    signOut: string;
    features: string;
    blog: string;
    requestAccess: string;
  };
  hero: {
    badge: string;
    headline: string;
    subtitle: string;
    ctaPrimary: string;
    ctaSecondary: string;
  };
  features: {
    eyebrow: string;
    headline: string;
    subtitle: string;
    deadlines: { title: string; body: string };
    dossier: { title: string; body: string };
    findings: { title: string; body: string };
    certificates: { title: string; body: string };
    viewer: { title: string; body: string };
    reports: { title: string; body: string };
  };
  howItWorks: {
    eyebrow: string;
    headline: string;
    step1: { title: string; body: string };
    step2: { title: string; body: string };
    step3: { title: string; body: string };
    step4: { title: string; body: string };
  };
  cta: {
    headline: string;
    subtitle: string;
    button: string;
  };
  footer: {
    tagline: string;
    product: string;
    resources: string;
    legal: string;
    privacy: string;
    terms: string;
    dpa: string;
    copyright: string;
  };
  blog: {
    eyebrow: string;
    headline: string;
    subtitle: string;
    empty: string;
    readingTime: string;
  };
  languageToggle: {
    label: string;
  };
  legalBrand: {
    backToSite: string;
  };
};
