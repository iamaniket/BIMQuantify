import type { LegalContent } from './types.js';

export const legalEnContent: LegalContent = {
  meta: {
    draftBanner: 'Draft – pending review by a Dutch IT-law specialist before going live.',
    lastUpdatedLabel: 'Last updated: {date}',
  },
  privacy: {
    title: 'Privacy policy',
    intro: 'BIMstitch processes personal data from kwaliteitsborgers, contractors and project teams using the BIMstitch portal. This policy describes which data we collect, for what purpose, and which rights you have under the GDPR.',
    lastUpdated: '2026-05-10',
    sections: [
      {
        title: 'Data we process',
        body: 'Account and contact data (name, email, organisation), project content you upload (IFC models, photos, documents), inspection findings and their metadata, and technical log data used to secure and improve the service.',
      },
      {
        title: 'Purpose of the processing',
        body: 'To run the Wet kwaliteitsborging voor het bouwen (Wkb) workflows you perform with us: managing assurance plans, inspections, findings and dossier preparation for the competent authority. We do not sell your data and do not use it for profiling or automated decision-making.',
      },
      {
        title: 'Retention',
        body: 'Data that is part of a Wet kwaliteitsborging voor het bouwen (Wkb) dossier is retained for 10 years after delivery in line with statutory retention obligations. Account and billing data is kept as long as necessary to perform the contract and any applicable tax retention period.',
      },
      {
        title: 'Your rights',
        body: 'You have the right to access, correction, restriction of processing, data portability and (within the limits of statutory retention) deletion. Requests can be sent to privacy@bimstitch.example. Complaints can also be filed with the Dutch Data Protection Authority.',
      },
      {
        title: 'Hosting and sub-processors',
        body: 'All personal data is hosted within the EU. A current list of sub-processors (such as our email, payment and storage providers) is included in the Data Processing Agreement (DPA).',
      },
    ],
  },
  terms: {
    title: 'Terms of service',
    intro: 'These terms apply to use of the BIMstitch portal by business users. By creating an account or using the portal, you agree to these terms.',
    lastUpdated: '2026-05-10',
    sections: [
      {
        title: 'The service',
        body: 'BIMstitch is a software platform for quality assurance under the Dutch Wet kwaliteitsborging voor het bouwen (Wkb). The portal supports risk assessments, assurance plans, inspections, findings and dossier preparation.',
      },
      {
        title: 'Your obligations',
        body: 'You provide accurate account information, do not share login credentials with third parties, and use the portal in compliance with applicable laws and regulations. Responsibility for the underlying work – such as filing notifications with the competent authority – remains with you.',
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
        body: 'You can cancel the subscription from the portal settings. Upon termination, Wet kwaliteitsborging voor het bouwen (Wkb) dossiers remain available for as long as legally required; afterwards they are securely deleted.',
      },
    ],
  },
  dpa: {
    title: 'Data processing agreement (DPA)',
    intro: 'This draft DPA describes how BIMstitch (processor) processes personal data on behalf of the customer (controller) when using the BIMstitch portal. A signable PDF version is available on request.',
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
        body: 'We apply appropriate technical and organisational measures, including encryption in transit and at rest, least-privilege access control, audit logging and periodic backups to a separate EU region.',
      },
      {
        title: 'Data breaches',
        body: 'If we suspect a data breach we notify the controller within 24 hours of discovery, with the information known so far and an initial assessment of impact and mitigation.',
      },
      {
        title: 'Rights of data subjects',
        body: 'We support the controller in responding to requests from data subjects (access, correction, deletion, data portability) within statutory deadlines.',
      },
      {
        title: 'Return and deletion',
        body: 'Upon termination of the main agreement, personal data is returned or securely deleted on request, subject to statutory retention obligations such as the 10-year Wet kwaliteitsborging voor het bouwen (Wkb) dossier retention.',
      },
    ],
  },
};
