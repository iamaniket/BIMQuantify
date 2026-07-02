import type { LegalContent } from './types.js';

export const legalEnContent: LegalContent = {
  meta: {
    draftBanner: 'Draft: still to be reviewed by a Dutch IT-law specialist before it goes live.',
    lastUpdatedLabel: 'Last updated: {date}',
  },
  privacy: {
    title: 'Privacy policy',
    intro: 'BimDossier processes personal data from kwaliteitsborgers, contractors and project teams using the BimDossier portal. This policy describes who we are, which data we collect, for what purpose and on what legal basis, who we share it with, how long we keep it, and which rights you have under the GDPR.',
    lastUpdated: '2026-07-02',
    sections: [
      {
        title: 'Who we are',
        body: 'BimDossier (trading name) is the controller for the personal data described in this policy. Contact us at info@bimdossier.nl for privacy questions, or security@bimdossier.nl to report a security concern. Our registered legal entity and Chamber of Commerce (KvK) number will be listed here once registration completes.',
      },
      {
        title: 'Data we process',
        body: 'Account and contact data (name, email, organisation, language preference), project content you upload (IFC models, photos, documents, certificates — which may contain metadata such as capture time and, for photos, location), inspection findings and their metadata, and technical/security log data (IP address, device/user-agent, and audit events) used to secure and improve the service.',
      },
      {
        title: 'Purpose of the processing',
        body: 'To run the Quality Assurance in Construction Act (Wkb) workflows you perform with us: managing assurance plans, inspections, findings and dossier preparation for the competent authority. We also process data to secure your account, to keep the service reliable, and to understand product usage. We do not sell your data and do not use it for profiling or automated decision-making.',
      },
      {
        title: 'Legal basis',
        body: 'We rely on: performance of our contract with you (Art. 6(1)(b)) for account management and delivering the service; a legal obligation (Art. 6(1)(c)) for Wkb dossier and tax retention; and our legitimate interests (Art. 6(1)(f)) for securing the service (security logging and abuse prevention), product analytics, and error monitoring. Where we ask for consent (Art. 6(1)(a)), you may withdraw it at any time.',
      },
      {
        title: 'Cookies',
        body: 'We use one functional cookie (NEXT_LOCALE, valid for one year) to remember your language choice. We do not use advertising or cross-site tracking cookies. Our product analytics (see below) runs without cookies.',
      },
      {
        title: 'Retention',
        body: 'Data that is part of a Quality Assurance in Construction Act (Wkb) dossier is retained for 10 years after delivery in line with statutory retention obligations. Account and billing data is kept as long as necessary to perform the contract and any applicable tax retention period. Security logs, notifications, and marketing enquiries are kept only as long as needed and then deleted, per our data-retention schedule.',
      },
      {
        title: 'Your rights',
        body: 'You have the right to access, correction, restriction of processing, data portability, objection to processing based on our legitimate interests (Art. 21), and (within the limits of statutory retention) deletion. Requests can be sent to info@bimdossier.nl. You can also lodge a complaint with the Dutch Data Protection Authority (Autoriteit Persoonsgegevens).',
      },
      {
        title: 'Hosting, analytics and sub-processors',
        body: 'All personal data is hosted within the EU. We use third parties to run the service: infrastructure/hosting and object storage (EU), PostHog for product analytics (EU-hosted, cookieless; for signed-in portal users this is linked to your account), Sentry for error monitoring (EU; no request bodies, no personal-data payloads), and an email provider for transactional messages. A current, named list of sub-processors is available on request and published in our legal centre.',
      },
    ],
  },
  terms: {
    title: 'Terms of service',
    intro: 'These terms apply to use of the BimDossier portal by business users. By creating an account or using the portal, you agree to these terms.',
    lastUpdated: '2026-05-10',
    sections: [
      {
        title: 'The service',
        body: 'BimDossier is a software platform for quality assurance under the Dutch Quality Assurance in Construction Act (Wkb). The portal supports risk assessments, assurance plans, inspections, findings and dossier preparation.',
      },
      {
        title: 'Your obligations',
        body: 'You provide accurate account information, do not share login credentials with third parties, and use the portal in compliance with applicable laws and regulations. Responsibility for the underlying work, such as filing notifications with the competent authority, stays with you.',
      },
      {
        title: 'Subscription and payment',
        body: 'Subscriptions run monthly or annually and renew automatically unless cancelled before the renewal date. Payment is made via the methods offered in the portal. In case of non-payment we may restrict access to the account.',
      },
      {
        title: 'Liability',
        body: 'Our liability is limited to direct damages up to the amount paid by you for the subscription in the preceding twelve months. Liability for indirect damages, consequential loss or missed savings is excluded, except in case of intent or wilful recklessness.',
      },
      {
        title: 'Termination',
        body: 'You can cancel the subscription from the portal settings. Upon termination, Quality Assurance in Construction Act (Wkb) dossiers remain available for as long as legally required; afterwards they are securely deleted.',
      },
    ],
  },
  dpa: {
    title: 'Data processing agreement (DPA)',
    intro: 'This draft DPA describes how BimDossier (processor) processes personal data on behalf of the customer (controller) when using the BimDossier portal. A signable PDF version is available on request.',
    lastUpdated: '2026-05-10',
    sections: [
      {
        title: 'Subject and duration',
        body: 'The processing concerns personal data of project participants and end users, for the duration of the main agreement and any statutory retention periods that apply afterwards.',
      },
      {
        title: 'Categories of data subjects and data',
        body: 'Data subjects: employees of the controller, kwaliteitsborgers, contractors and other project participants. Data: contact and account details, project content, inspection evidence (photos, location data) and usage logs.',
      },
      {
        title: 'Sub-processors',
        body: 'We use carefully selected sub-processors within the EU for hosting, email, payment processing and error monitoring. A current list is available on request; we notify the controller in advance of any changes.',
      },
      {
        title: 'Security measures',
        body: 'We apply appropriate technical and organisational measures, including encryption in transit and at rest, least-privilege access control, audit logging and regular backups.',
      },
      {
        title: 'Data breaches',
        body: 'If we suspect a data breach we notify the controller without undue delay after discovery, with the information known so far and an initial assessment of impact and mitigation.',
      },
      {
        title: 'Rights of data subjects',
        body: 'We support the controller in responding to requests from data subjects (access, correction, deletion, data portability) within statutory deadlines.',
      },
      {
        title: 'Return and deletion',
        body: 'Upon termination of the main agreement, personal data is returned or securely deleted on request, subject to statutory retention obligations such as the 10-year Quality Assurance in Construction Act (Wkb) dossier retention.',
      },
    ],
  },
};
