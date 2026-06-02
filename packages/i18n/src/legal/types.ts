export type LegalSection = {
  title: string;
  body: string;
};

export type LegalDocument = {
  title: string;
  intro: string;
  lastUpdated: string;
  sections: LegalSection[];
};

export type LegalMeta = {
  draftBanner: string;
  lastUpdatedLabel: string;
};

export type LegalContent = {
  meta: LegalMeta;
  privacy: LegalDocument;
  terms: LegalDocument;
  dpa: LegalDocument;
};
